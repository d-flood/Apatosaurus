import type { Kysely, Selectable } from 'kysely';
import type { Database, SyncFileFingerprints } from '$lib/db/types.generated';
import {
	createCommittedCollationCheckpointWithFiles,
	loadCommittedCollationPayloadWithFiles,
	saveWorkingCollationArtifact,
} from '$lib/db/repositories/collation-files';
import { createCommittedTranscriptionCheckpointWithFiles } from '$lib/db/repositories/transcription-files';
import {
	readCanonicalDocument,
	TOMBSTONE_FORMAT,
	tombstonedProjectPaths,
	type TombstonePayload,
} from '$lib/storage/formats';
import { teiContentHash } from '$lib/storage/tei-content';
import {
	deleteDirectory,
	deleteFile,
	readTextFile,
	statFile,
	statFilesUnder,
	type StoreFileStat,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import { joinStorePath } from '$lib/storage/layout';
import {
	classifyDocumentPath,
	documentStorageOfPath,
	hasLegacyHeads,
	isCoveredByDeletionPaths,
	isSupersededJsonDocumentPath,
	teiPrimaryPathsOfManifest,
	type DocumentKind,
} from '$lib/storage/document-files';
import {
	getCollationContentHash,
	getTranscriptionContentHash,
} from '$lib/db/repositories/document-fingerprints';
import { mapConcurrently } from './map-concurrently';
import {
	upsertProjectPlacements,
	type DeletedNotice,
	type MovedNotice,
} from '$lib/storage/project-locations';
import { fingerprintContent, type FileFingerprint } from '$lib/storage/content-hash';
import type { StoreQuarantineRecord, StoreQuarantineReason } from '$lib/storage/quarantine';
import {
	addOrphanPrimaryToManifest,
	rebuildIndexFromStore,
	restoreOrphanPrimaryToProject,
	type IndexRebuildProgress,
} from '$lib/db/repositories/index-rebuild';
import { refreshChangedDocumentFiles } from '$lib/db/repositories/document-refresh';
import { writeProjectManifestFile } from '$lib/db/repositories/project-files';
import {
	createCollationConflictCopy,
	createProjectTranscriptionConflictCopy,
	listConflictCopies,
	type SyncEntityHead,
} from './conflicts';
import type { SyncEntityReference, SyncEntityType, SyncProjectContext } from './backup-status';
import {
	isCloudProviderError,
	type CloudFileMetadata,
	type CloudListResult,
	type CloudProviderErrorCode,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './providers/provider';
import type { DbExecutor } from '$lib/db/worker-kysely';
import { validateProjectFilesWithTemporaryStaging } from './project-file-staging';
import { loadLocalEntity, type LocalEntityState } from './backup-summary';
import {
	loadProjectStoreRoot,
	isBinaryProjectFile,
	isMissingStoreEntryError,
	projectFileText,
	readProjectFile,
	shouldMirrorProjectFile,
	normalizeSlashes,
	writeProjectFileAtomic,
	type ProjectFileContent,
} from './project-archive';
import {
	DELETED_MARKER_FILE,
	MOVED_MARKER_FILE,
	parseDeletedMarker,
	parseMovedMarker,
} from './moved-marker';

export type SyncUiState =
	| 'saved locally'
	| 'sync pending'
	| 'synced'
	| 'remote update available'
	| 'conflict requires resolution';

export interface SyncManagerOptions {
	authorName?: string;
	now?: () => string;
	storeOptions?: StoreOperationOptions;
	remoteCursor?: string;
	exclusive?: Exclusive;
	onIndexProgress?: (progress: IndexRebuildProgress) => void;
	/** Projects this session has hashed in full; their files' unchanged size and time are trusted. */
	hashedProjects?: Set<string>;
}

type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;

interface SyncQuarantine {
	path: string;
	code: StoreQuarantineReason['code'];
	message: string;
	expected?: unknown;
	actual?: unknown;
}

export interface SyncOperationResult {
	uiState: SyncUiState;
	entityType?: SyncEntityType;
	entityId?: string;
	checkpointId?: string;
	draftCheckpointId?: string;
	conflictCopyId?: string;
	moved?: MovedNotice;
	deleted?: DeletedNotice;
	localHead?: SyncEntityHead;
	remoteHead?: SyncEntityHead;
	providerError?: CloudProviderErrorCode;
	providerMessage?: string;
	uploadedPaths: string[];
	downloadedPaths: string[];
	deletedPaths: string[];
	quarantines: SyncQuarantine[];
}

export interface ProjectBackupResult extends SyncOperationResult {
	projectId: string;
	manifestUploaded: boolean;
	entityResults: SyncOperationResult[];
	hasConflictCopies?: boolean;
	remoteCursor?: string;
}

type ContentLoader = () => Promise<ProjectFileContent>;

interface LocalMirrorFile {
	path: string;
	storePath: string;
	content: ContentLoader;
	fingerprint: FileFingerprint;
}

interface RemoteMirrorFile {
	path: string;
	metadata: CloudFileMetadata;
	content: ContentLoader | null;
	fingerprint: FileFingerprint;
}

interface LocalMirrorState {
	projectRoot: string;
	localFiles: LocalMirrorFile[];
	remoteFiles: Map<string, RemoteMirrorFile>;
	missing: Array<{ metadata: CloudFileMetadata; path: string }>;
}

interface EntityHead {
	entityType: string;
	entityId: string;
	revisionId: string;
	contentHash: string;
}

type RemoteOperation =
	| {
			kind: 'upload';
			path: string;
			content: ProjectFileContent;
			file: CloudFileMetadata | null;
			localFile: LocalMirrorFile;
			remoteFingerprint: FileFingerprint;
			entity?: EntityHead;
			write?: CloudWriteResult;
			applied?: boolean;
	  }
	| { kind: 'delete'; path: string; file: CloudFileMetadata; applied?: boolean };

interface SyncFileFingerprintRecord {
	targetId: string;
	projectId: string;
	filePath: string;
	localContentHash: string;
	localSize: number;
	localModifiedAt: string;
	remoteFileId: string;
	remoteRevision: string;
	remoteContentHash: string;
	remoteSize: number;
	remoteModifiedAt: string;
	syncedAt: string;
	entityType: string;
	entityId: string;
	revisionId: string;
	entityContentHash: string;
}

export async function backupProject(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	options: SyncManagerOptions = {}
): Promise<ProjectBackupResult> {
	const exclusive = options.exclusive ?? (work => work());
	// Opening the project converts its JSON documents to TEI; until then it does not sync.
	if (await exclusive(() => awaitsTeiConversion(db, context.projectId, options.storeOptions)))
		return {
			...baseResult('sync pending'),
			projectId: context.projectId,
			manifestUploaded: false,
			entityResults: [],
		};
	const changes = options.remoteCursor
		? await remoteChangesSince(provider, context, options.remoteCursor)
		: null;
	if (changes) {
		const unchanged = await exclusive(async () => {
			if (!(await changesAlreadySynced(db, context, changes.entries))) return null;
			const pending = await listPendingUploadPaths(
				db,
				context,
				options.storeOptions,
				trustsStat(options, context)
			);
			if (pending.length > 0) return null;
			return {
				...baseResult('synced'),
				projectId: context.projectId,
				manifestUploaded: true,
				entityResults: [],
				hasConflictCopies: (await listConflictCopies(db, context.projectId)).length > 0,
				remoteCursor: changes.cursor,
			};
		});
		if (unchanged) {
			options.hashedProjects?.add(context.projectId);
			return unchanged;
		}
	}
	const result = await backupProjectFiles(db, provider, context, options, exclusive);
	if (result.uiState === 'synced') options.hashedProjects?.add(context.projectId);
	return result;
}

function trustsStat(options: SyncManagerOptions, context: SyncProjectContext): boolean {
	return options.hashedProjects?.has(context.projectId) ?? false;
}

async function awaitsTeiConversion(
	db: DbExecutor,
	projectId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<boolean> {
	const root = await loadProjectStoreRoot(db, projectId);
	const manifest = await readLocalMirrorFile(root, 'project.json', storeOptions);
	const content = await manifest?.content();
	const record = typeof content === 'string' ? parseJsonRecord(content) : null;
	return (
		Array.isArray(record?.transcriptions) &&
		Array.isArray(record.collations) &&
		hasLegacyHeads(record as unknown as Parameters<typeof hasLegacyHeads>[0])
	);
}

async function backupProjectFiles(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	options: SyncManagerOptions,
	exclusive: Exclusive
): Promise<ProjectBackupResult> {
	const backupContext = await ensureProjectBackupFolder(provider, context);
	const result: ProjectBackupResult = {
		...baseResult('sync pending'),
		projectId: backupContext.projectId,
		manifestUploaded: false,
		entityResults: [],
	};

	const mirrorResult = await mirrorProjectFiles(db, provider, backupContext, options, exclusive);
	mergeOperationResult(result, mirrorResult);
	result.entityResults.push(mirrorResult);
	if (result.moved || result.deleted) {
		result.uiState = 'saved locally';
		return result;
	}
	result.manifestUploaded = !hasOperationFailure(mirrorResult);
	result.hasConflictCopies = await exclusive(
		async () => (await listConflictCopies(db, backupContext.projectId)).length > 0
	);

	if (result.manifestUploaded && !hasOperationFailure(result)) {
		result.uiState = 'synced';
		result.remoteCursor = mirrorResult.remoteCursor;
		return result;
	}

	result.uiState =
		result.quarantines.length > 0 ? 'conflict requires resolution' : 'sync pending';
	return result;
}

async function remoteChangesSince(
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	cursor: string
): Promise<{ entries: CloudFileMetadata[]; cursor: string } | null> {
	try {
		const entries: CloudFileMetadata[] = [];
		let next: string | undefined = cursor;
		let page: CloudListResult;
		do {
			page = await provider.listFiles(context.cloudFolderId, {
				recursive: true,
				cursor: next,
			});
			entries.push(
				...page.entries.filter(
					entry =>
						entry.isDeleted ||
						(!entry.isFolder &&
							shouldMirrorProjectFile(relativeEntryPath(entry.path, context)))
				)
			);
			next = page.cursor;
		} while (page.hasMore && next);
		return next ? { entries, cursor: next } : null;
	} catch (error) {
		if (isCloudProviderError(error)) return null;
		throw error;
	}
}

/** Our own uploads and deletes come back as changes; they match what the fingerprints already record. */
async function changesAlreadySynced(
	db: DbExecutor,
	context: SyncProjectContext,
	changes: CloudFileMetadata[]
): Promise<boolean> {
	if (changes.length === 0) return true;
	const synced = await listSyncedRemoteRevisions(db, context);
	return changes.every(entry => {
		const path = relativeEntryPath(entry.path, context);
		if (!entry.isDeleted) return synced.get(path) === entry.revision;
		return ![...synced.keys()].some(
			syncedPath => syncedPath === path || syncedPath.startsWith(`${path}/`)
		);
	});
}

async function listSyncedRemoteRevisions(
	db: DbExecutor,
	context: SyncProjectContext
): Promise<Map<string, string>> {
	const rows = await db
		.selectFrom('sync_file_fingerprints')
		.select(['file_path', 'remote_revision'])
		.where('target_id', '=', context.connectionId)
		.where('project_id', '=', context.projectId)
		.execute();
	return new Map(rows.map(row => [row.file_path, row.remote_revision]));
}

async function ensureProjectBackupFolder(
	provider: CloudStorageProvider,
	context: SyncProjectContext
): Promise<SyncProjectContext> {
	try {
		await provider.listFiles(context.cloudFolderId, { recursive: false });
		return context;
	} catch (error) {
		if (!isCloudProviderError(error, 'not-found')) throw error;
	}

	const folderPath = normalizeSlashes(context.cloudFolderPath ?? context.cloudFolderId);
	const segments = folderPath
		.split('/')
		.map(segment => segment.trim())
		.filter(Boolean);
	if (segments.length === 0) throw new Error('Backup folder path is required.');

	let parentFolderId = providerRootFolderId(provider);
	for (const segment of segments) {
		parentFolderId = await provider.createFolder(segment, parentFolderId);
	}
	return { ...context, cloudFolderId: parentFolderId, cloudFolderPath: folderPath };
}

/**
 * Network work runs outside `exclusive`; every local read, decision and write runs inside it.
 * Uploads record the local content they sent, so edits made while they run stay pending.
 */
async function mirrorProjectFiles(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	options: SyncManagerOptions,
	exclusive: Exclusive
): Promise<SyncOperationResult & { remoteCursor?: string }> {
	const result: SyncOperationResult & { remoteCursor?: string } = baseResult('sync pending');
	const now = options.now?.() ?? new Date().toISOString();
	const storeOptions = options.storeOptions ?? {};
	try {
		const { entries: remoteMetadata, cursor: remoteCursor } = await listRemoteMetadata(
			provider,
			context
		);
		result.remoteCursor = remoteCursor;
		const movedEntry = remoteMetadata.find(
			entry => relativeEntryPath(entry.path, context) === MOVED_MARKER_FILE
		);
		if (movedEntry) {
			const moved = parseMovedMarker(await provider.downloadFile(movedEntry.id));
			result.moved = moved;
			await exclusive(() => markProjectRetired(db, context, { moved }, storeOptions));
			return result;
		}
		const deletedEntry = remoteMetadata.find(
			entry => relativeEntryPath(entry.path, context) === DELETED_MARKER_FILE
		);
		if (deletedEntry) {
			const deleted = parseDeletedMarker(await provider.downloadFile(deletedEntry.id));
			result.deleted = deleted;
			await exclusive(() => markProjectRetired(db, context, { deleted }, storeOptions));
			return result;
		}

		const mirrored = remoteMetadata
			.map(metadata => ({ metadata, path: relativeEntryPath(metadata.path, context) }))
			.filter(({ path }) => shouldMirrorProjectFile(path));
		const syncedRevisions = await exclusive(() => listSyncedRemoteRevisions(db, context));
		const downloaded = new Map<string, ProjectFileContent>();
		await downloadRemoteContents(
			provider,
			mirrored.filter(
				({ path, metadata }) => syncedRevisions.get(path) !== metadata.revision
			),
			downloaded
		);

		let operations: RemoteOperation[] | undefined;
		for (let attempt = 1; !operations; attempt++) {
			const outcome = await exclusive(async () => {
				const load = () =>
					loadLocalMirrorState(
						db,
						context,
						mirrored,
						downloaded,
						storeOptions,
						trustsStat(options, context)
					);
				let local = await load();
				if (local.missing.length > 0) {
					if (attempt < 3) return { missing: local.missing };
					await downloadRemoteContents(provider, local.missing, downloaded);
					local = await load();
				}
				return {
					operations: await reconcileLocalMirror(
						db,
						context,
						local,
						result,
						options,
						now
					),
				};
			});
			if ('operations' in outcome) operations = outcome.operations;
			else await downloadRemoteContents(provider, outcome.missing, downloaded);
		}

		let failure: unknown;
		try {
			await applyRemoteOperations(provider, context, operations, result);
		} catch (error) {
			failure = error;
		}
		await exclusive(() => recordRemoteOperations(db, context, operations, now));
		if (failure) throw failure;

		result.uiState = result.quarantines.length > 0 ? 'conflict requires resolution' : 'synced';
		return result;
	} catch (error) {
		if (isCloudProviderError(error)) {
			result.providerError = error.code;
			result.providerMessage = error.message;
			result.uiState =
				error.code === 'conflict' ? 'conflict requires resolution' : 'sync pending';
			return result;
		}
		throw error;
	}
}

async function downloadRemoteContents(
	provider: CloudStorageProvider,
	files: Array<{ metadata: CloudFileMetadata; path: string }>,
	downloaded: Map<string, ProjectFileContent>
): Promise<void> {
	await mapConcurrently(files, async ({ metadata, path }) => {
		downloaded.set(
			path,
			isBinaryProjectFile(path)
				? await provider.downloadFileBytes(metadata.id)
				: await provider.downloadFile(metadata.id)
		);
	});
}

async function loadLocalMirrorState(
	db: DbExecutor,
	context: SyncProjectContext,
	mirrored: Array<{ metadata: CloudFileMetadata; path: string }>,
	downloaded: Map<string, ProjectFileContent>,
	storeOptions: StoreOperationOptions,
	trustStat: boolean
): Promise<LocalMirrorState> {
	const projectRoot = await loadProjectStoreRoot(db, context.projectId);
	const localFiles = await listLocalProjectMirrorFiles(db, context, storeOptions, trustStat);
	const localByPath = new Map(localFiles.map(file => [file.path, file]));
	const synced = new Map(
		(
			await db
				.selectFrom('sync_file_fingerprints')
				.select(['file_path', 'remote_revision', 'remote_content_hash'])
				.where('target_id', '=', context.connectionId)
				.where('project_id', '=', context.projectId)
				.execute()
		).map(row => [row.file_path, row])
	);
	const remoteFiles = new Map<string, RemoteMirrorFile>();
	const missing: Array<{ metadata: CloudFileMetadata; path: string }> = [];
	for (const { metadata, path } of mirrored) {
		const content = downloaded.get(path);
		const row = synced.get(path);
		const local = localByPath.get(path);
		if (content !== undefined) {
			remoteFiles.set(path, {
				path,
				metadata,
				content: loaded(content),
				fingerprint: await fingerprintContent(content, metadata.modifiedAt),
			});
		} else if (local && row?.remote_revision === metadata.revision) {
			remoteFiles.set(path, {
				path,
				metadata,
				content:
					local.fingerprint.contentHash === row.remote_content_hash
						? local.content
						: null,
				fingerprint: {
					contentHash: row.remote_content_hash,
					size: metadata.size,
					modifiedAt: metadata.modifiedAt,
				},
			});
		} else {
			missing.push({ metadata, path });
		}
	}
	return { projectRoot, localFiles, remoteFiles, missing };
}

async function reconcileLocalMirror(
	db: Kysely<Database>,
	context: SyncProjectContext,
	{ projectRoot, localFiles: initialLocalFiles, remoteFiles }: LocalMirrorState,
	result: SyncOperationResult,
	options: SyncManagerOptions,
	now: string
): Promise<RemoteOperation[]> {
	const storeOptions = options.storeOptions ?? {};
	const operations: RemoteOperation[] = [];
	const upload = async (
		localFile: LocalMirrorFile,
		remoteFingerprint: FileFingerprint,
		file: CloudFileMetadata | null
	) => {
		operations.push({
			kind: 'upload',
			path: localFile.path,
			content: await localFile.content(),
			file,
			localFile,
			remoteFingerprint,
		});
	};
	const remove = (file: RemoteMirrorFile) => {
		operations.push({ kind: 'delete', path: file.path, file: file.metadata });
		remoteFiles.delete(file.path);
	};
	let localFiles = initialLocalFiles;
	const pulledFiles: Array<{ localFile: LocalMirrorFile; remoteFile: RemoteMirrorFile }> = [];
	const remoteOnlyPrimaryPaths: string[] = [];
	const tombstonedPaths: string[] = [];
	const isTombstoned = (path: string) => isCoveredByDeletionPaths(tombstonedPaths, path);
	const removeRemoteCoveredBy = (paths: string[]) => {
		for (const file of [...remoteFiles.values()])
			if (isCoveredByDeletionPaths(paths, file.path)) remove(file);
	};
	const conflicts: Array<{ reference: SyncEntityReference; remoteFile: RemoteMirrorFile }> = [];
	let pulledTombstone = false;
	const teiPrimaryPaths = new Set([
		...manifestTeiPrimaryPaths(
			await localFiles.find(file => file.path === 'project.json')?.content()
		),
		...manifestTeiPrimaryPaths(await remoteFiles.get('project.json')?.content?.()),
	]);

	for (const localFile of localFiles.filter(file => file.path.startsWith('tombstones/'))) {
		const parsed = await readCanonicalDocument<TombstonePayload>(
			TOMBSTONE_FORMAT,
			projectFileText(await localFile.content())
		);
		if (!parsed.ok) {
			result.quarantines.push(quarantineFor(localFile.path, parsed.quarantine));
			continue;
		}
		const remoteFile = remoteFiles.get(localFile.path) ?? null;
		if (remoteFile?.fingerprint.contentHash === localFile.fingerprint.contentHash) {
			await upsertFileFingerprint(
				db,
				context,
				localFile,
				remoteFile.metadata,
				localFile.fingerprint,
				now
			);
		} else {
			await upload(localFile, localFile.fingerprint, remoteFile?.metadata ?? null);
		}

		const paths = tombstonedProjectPaths(parsed.payload);
		tombstonedPaths.push(...paths);
		removeRemoteCoveredBy(paths);
	}

	for (const remoteFile of [...remoteFiles.values()].filter(file =>
		file.path.startsWith('tombstones/')
	)) {
		if (localFiles.some(file => file.path === remoteFile.path)) continue;
		const content = await remoteContent(remoteFile);
		const validation = await validateProjectFilesWithTemporaryStaging(
			[{ path: remoteFile.path, content }],
			{ projectId: context.projectId, storeOptions }
		);
		if (validation.quarantinedFiles.length) {
			result.quarantines.push(...validation.quarantinedFiles.map(storeQuarantineForSync));
			continue;
		}
		const parsed = await readCanonicalDocument<TombstonePayload>(
			TOMBSTONE_FORMAT,
			projectFileText(content)
		);
		if (!parsed.ok) {
			result.quarantines.push(quarantineFor(remoteFile.path, parsed.quarantine));
			continue;
		}
		const pulledLocalFile = await writePulledMirrorFile(projectRoot, remoteFile, storeOptions);
		const paths = tombstonedProjectPaths(parsed.payload);
		tombstonedPaths.push(...paths);
		for (const path of paths) {
			await (path.endsWith('/') ? deleteStoreDirectoryIfExists : deleteStoreFileIfExists)(
				joinStorePath(projectRoot, path),
				storeOptions
			);
		}
		pulledFiles.push({ localFile: pulledLocalFile, remoteFile });
		result.downloadedPaths.push(remoteFile.path);
		pulledTombstone = true;
		removeRemoteCoveredBy(paths);
	}

	if (pulledTombstone) {
		await keepingFingerprints(db, () => rebuildIndexFromStore(db, storeOptions));
		await writeProjectManifestFile(db, context.projectId, {}, storeOptions);
		localFiles = await listLocalProjectMirrorFiles(
			db,
			context,
			storeOptions,
			trustsStat(options, context)
		);
	}

	const analysisWinners = new Map<string, 'local' | 'remote'>();
	for (const localFile of localFiles) {
		const analysisId = /^cbgm\/([^/]+)\.json$/.exec(localFile.path)?.[1];
		const remoteFile = remoteFiles.get(localFile.path);
		if (!analysisId || !remoteFile) continue;
		if (remoteFile.fingerprint.contentHash === localFile.fingerprint.contentHash) continue;
		const cached = await getFileFingerprint(db, context, localFile.path);
		analysisWinners.set(
			analysisId,
			cached?.localContentHash === localFile.fingerprint.contentHash &&
				cached.remoteContentHash !== remoteFile.fingerprint.contentHash
				? 'remote'
				: 'local'
		);
	}

	const localPaths = new Set(localFiles.map(file => file.path));
	for (const localFile of localFiles) {
		if (
			localFile.path === 'project.json' ||
			localFile.path.startsWith('tombstones/') ||
			classifyDocumentPath(localFile.path, teiPrimaryPaths)?.role === 'unlisted' ||
			isTombstoned(localFile.path)
		)
			continue;
		const remoteFile = remoteFiles.get(localFile.path) ?? null;
		if (isSupersededJsonDocumentPath(localFile.path, teiPrimaryPaths)) {
			if (remoteFile) remove(remoteFile);
			continue;
		}
		const cached = await getFileFingerprint(db, context, localFile.path);
		if (!remoteFile) {
			await upload(localFile, localFile.fingerprint, null);
			continue;
		}

		if (remoteFile.fingerprint.contentHash === localFile.fingerprint.contentHash) {
			await upsertFileFingerprint(
				db,
				context,
				localFile,
				remoteFile.metadata,
				remoteFile.fingerprint,
				now
			);
			continue;
		}

		const localUnchanged = cached
			? cached.localContentHash === localFile.fingerprint.contentHash
			: false;
		const remoteUnchanged = cached
			? cached.remoteContentHash === remoteFile.fingerprint.contentHash
			: false;
		// CBGM results are derived: on divergence this sync's upload is the last write and wins, and
		// an analysis's files follow its metadata so the cache keeps matching cache_hash.
		const analysisId = cbgmAnalysisIdForPath(localFile.path);
		const winner =
			(!remoteUnchanged && analysisId && analysisWinners.get(analysisId)) ||
			(localUnchanged && !remoteUnchanged
				? 'remote'
				: remoteUnchanged || isBinaryProjectFile(localFile.path)
					? 'local'
					: await resolveDivergentFile(
							localFile.path,
							projectFileText(await localFile.content()),
							projectFileText(await remoteContent(remoteFile)),
							teiPrimaryPaths
						));
		if (winner === 'remote') {
			const validation = await validateProjectFilesWithTemporaryStaging(
				[{ path: remoteFile.path, content: await remoteContent(remoteFile) }],
				{ projectId: context.projectId, storeOptions, teiPrimaryPaths }
			);
			if (validation.quarantinedFiles.length) {
				result.quarantines.push(...validation.quarantinedFiles.map(storeQuarantineForSync));
				continue;
			}
			const pulledLocalFile = await writePulledMirrorFile(
				projectRoot,
				remoteFile,
				storeOptions
			);
			pulledFiles.push({ localFile: pulledLocalFile, remoteFile });
			result.downloadedPaths.push(remoteFile.path);
			continue;
		}
		if (winner === 'local') {
			await upload(localFile, localFile.fingerprint, remoteFile.metadata);
			continue;
		}

		const validation = await validateProjectFilesWithTemporaryStaging(
			[{ path: remoteFile.path, content: await remoteContent(remoteFile) }],
			{ projectId: context.projectId, storeOptions, teiPrimaryPaths }
		);
		if (validation.quarantinedFiles.length) {
			result.quarantines.push(...validation.quarantinedFiles.map(storeQuarantineForSync));
			continue;
		}
		result.quarantines.push({
			path: localFile.path,
			code: 'hash_mismatch',
			message: 'Local and remote files both differ from the last synced fingerprint.',
			expected: cached?.remoteContentHash ?? localFile.fingerprint.contentHash,
			actual: remoteFile.fingerprint.contentHash,
		});
		const reference = primaryReferenceForMirrorPath(localFile.path, teiPrimaryPaths);
		if (reference) conflicts.push({ reference, remoteFile });
	}

	for (const remoteFile of [...remoteFiles.values()].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
		if (localPaths.has(remoteFile.path)) continue;
		if (isSupersededJsonDocumentPath(remoteFile.path, teiPrimaryPaths)) {
			remove(remoteFile);
			continue;
		}
		if (
			remoteFile.path === 'project.json' ||
			remoteFile.path.startsWith('tombstones/') ||
			classifyDocumentPath(remoteFile.path, teiPrimaryPaths)?.role === 'unlisted' ||
			isTombstoned(remoteFile.path)
		)
			continue;
		const validation = await validateProjectFilesWithTemporaryStaging(
			[{ path: remoteFile.path, content: await remoteContent(remoteFile) }],
			{ projectId: context.projectId, storeOptions, teiPrimaryPaths }
		);
		if (validation.quarantinedFiles.length) {
			result.quarantines.push(...validation.quarantinedFiles.map(storeQuarantineForSync));
			continue;
		}
		const pulledLocalFile = await writePulledMirrorFile(projectRoot, remoteFile, storeOptions);
		pulledFiles.push({ localFile: pulledLocalFile, remoteFile });
		if (primaryReferenceForMirrorPath(remoteFile.path, teiPrimaryPaths)) {
			remoteOnlyPrimaryPaths.push(joinStorePath(projectRoot, remoteFile.path));
		}
		result.downloadedPaths.push(remoteFile.path);
	}

	for (const { reference, remoteFile } of conflicts) {
		const local = await loadLocalEntity(db, reference, options.storeOptions);
		const copyId = await createConflictCopy(db, local, options);
		result.conflictCopyId ??= copyId;
		const mirrorFiles = await listLocalProjectMirrorFiles(
			db,
			context,
			storeOptions,
			trustsStat(options, context)
		);
		const copyPrimaryPaths = manifestTeiPrimaryPaths(
			await mirrorFiles.find(file => file.path === 'project.json')?.content()
		);
		const copyFiles = mirrorFiles.filter(file =>
			isConflictCopyFile(file.path, reference.entityType, copyId, copyPrimaryPaths)
		);
		for (const file of copyFiles) {
			await upload(file, file.fingerprint, null);
		}
		pulledFiles.push({
			localFile: await writePulledMirrorFile(projectRoot, remoteFile, storeOptions),
			remoteFile,
		});
		result.downloadedPaths.push(remoteFile.path);
	}
	if (pulledFiles.length > 0) {
		// Only TEI document pulls skip the rebuild.
		if (
			pulledFiles.every(({ localFile }) => isTeiDocumentFile(localFile.path, teiPrimaryPaths))
		) {
			for (const path of remoteOnlyPrimaryPaths) {
				await addOrphanPrimaryToManifest(path, storeOptions);
			}
			await refreshChangedDocumentFiles(
				db,
				context.projectId,
				storeOptions,
				options.onIndexProgress
			);
		} else {
			await keepingFingerprints(db, async () => {
				await rebuildIndexFromStore(db, storeOptions);
				for (const path of remoteOnlyPrimaryPaths) {
					await restoreOrphanPrimaryToProject(db, path, storeOptions);
				}
			});
		}
		for (const pulled of pulledFiles) {
			await upsertFileFingerprint(
				db,
				context,
				pulled.localFile,
				pulled.remoteFile.metadata,
				pulled.remoteFile.fingerprint,
				now
			);
		}
	}

	await writeProjectManifestFile(db, context.projectId, {}, storeOptions);
	const manifestFile = await readLocalMirrorFile(projectRoot, 'project.json', storeOptions);
	if (manifestFile) {
		const remoteManifest = remoteFiles.get(manifestFile.path) ?? null;
		if (remoteManifest?.fingerprint.contentHash === manifestFile.fingerprint.contentHash) {
			await upsertFileFingerprint(
				db,
				context,
				manifestFile,
				remoteManifest.metadata,
				remoteManifest.fingerprint,
				now
			);
		} else {
			await upload(manifestFile, manifestFile.fingerprint, remoteManifest?.metadata ?? null);
		}
	}
	for (const operation of operations) {
		if (operation.kind === 'upload') {
			operation.entity = await mirrorPathEntityHead(db, operation.localFile.path);
		}
	}
	return operations;
}

async function applyRemoteOperations(
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	operations: RemoteOperation[],
	result: SyncOperationResult
): Promise<void> {
	for (const operation of operations) {
		if (operation.kind === 'delete') {
			await provider.deleteFile(
				operation.file.id,
				provider.capabilities.supportsExpectedRevisionDelete
					? operation.file.revision
					: undefined
			);
			result.deletedPaths.push(operation.path);
		} else {
			operation.write = operation.file
				? await provider.updateFile(
						operation.file.id,
						operation.content,
						operation.file.revision
					)
				: await provider.createFile(
						context.cloudFolderId,
						operation.path,
						operation.content
					);
			result.uploadedPaths.push(operation.path);
		}
		operation.applied = true;
	}
}

async function recordRemoteOperations(
	db: DbExecutor,
	context: SyncProjectContext,
	operations: RemoteOperation[],
	now: string
): Promise<void> {
	for (const operation of operations) {
		if (!operation.applied) continue;
		if (operation.kind === 'delete') {
			await db
				.deleteFrom('sync_file_fingerprints')
				.where('target_id', '=', context.connectionId)
				.where('project_id', '=', context.projectId)
				.where('file_path', '=', operation.path)
				.execute();
		} else {
			await upsertFileFingerprint(
				db,
				context,
				operation.localFile,
				operation.write!,
				operation.remoteFingerprint,
				now,
				operation.entity
			);
		}
	}
}

async function remoteContent(file: RemoteMirrorFile): Promise<ProjectFileContent> {
	if (file.content === null) throw new Error(`Sync did not download ${file.path}.`);
	return file.content();
}

export async function listPendingUploadPaths(
	db: DbExecutor,
	context: SyncProjectContext,
	storeOptions: StoreOperationOptions = {},
	trustStat = false
): Promise<string[]> {
	const localFiles = await listLocalProjectMirrorFiles(db, context, storeOptions, trustStat);
	const synced = await loadSyncedLocalFingerprints(db, context);
	return localFiles
		.filter(file => synced.get(file.path)?.local_content_hash !== file.fingerprint.contentHash)
		.map(file => file.path);
}

/**
 * Reads and hashes only files whose size or modification time differ from the last sync, unless
 * `trustStat` is false. A hash that still matches records the file's new size and time.
 */
async function listLocalProjectMirrorFiles(
	db: DbExecutor,
	context: SyncProjectContext,
	storeOptions: StoreOperationOptions,
	trustStat: boolean
): Promise<LocalMirrorFile[]> {
	const root = await loadProjectStoreRoot(db, context.projectId);
	const [stats, synced] = await Promise.all([
		statFilesUnder(root, storeOptions),
		loadSyncedLocalFingerprints(db, context),
	]);
	const files: LocalMirrorFile[] = [];
	for (const [storePath, stat] of stats) {
		const path = storePath.slice(root.length + 1);
		if (!shouldMirrorProjectFile(path)) continue;
		const modifiedAt = statModifiedAt(stat);
		const row = synced.get(path);
		const content = readOnce(path, storePath, storeOptions);
		if (
			trustStat &&
			row &&
			modifiedAt &&
			row.local_size === stat.size &&
			row.local_modified_at === modifiedAt
		) {
			files.push({
				path,
				storePath,
				content,
				fingerprint: { contentHash: row.local_content_hash, size: stat.size, modifiedAt },
			});
			continue;
		}
		const { contentHash } = await fingerprintContent(await content(), modifiedAt);
		files.push({
			path,
			storePath,
			content,
			fingerprint: { contentHash, size: stat.size, modifiedAt },
		});
		if (
			row?.local_content_hash === contentHash &&
			(row.local_size !== stat.size || row.local_modified_at !== modifiedAt)
		) {
			await db
				.updateTable('sync_file_fingerprints')
				.set({ local_size: stat.size, local_modified_at: modifiedAt })
				.where('target_id', '=', context.connectionId)
				.where('project_id', '=', context.projectId)
				.where('file_path', '=', path)
				.execute();
		}
	}
	return files.sort(
		(left, right) =>
			mirrorWriteOrder(left.path) - mirrorWriteOrder(right.path) ||
			left.path.localeCompare(right.path)
	);
}

async function loadSyncedLocalFingerprints(db: DbExecutor, context: SyncProjectContext) {
	const rows = await db
		.selectFrom('sync_file_fingerprints')
		.select(['file_path', 'local_content_hash', 'local_size', 'local_modified_at'])
		.where('target_id', '=', context.connectionId)
		.where('project_id', '=', context.projectId)
		.execute();
	return new Map(rows.map(row => [row.file_path, row]));
}

// Backends without stat report lastModified 0; an empty time never matches a recorded one.
function statModifiedAt(stat: StoreFileStat): string {
	return stat.lastModified ? String(stat.lastModified) : '';
}

function readOnce(
	path: string,
	storePath: string,
	storeOptions: StoreOperationOptions
): ContentLoader {
	let read: Promise<ProjectFileContent> | undefined;
	return () => (read ??= readProjectFile(path, storePath, storeOptions));
}

function loaded(content: ProjectFileContent): ContentLoader {
	return () => Promise.resolve(content);
}

async function markProjectRetired(
	db: DbExecutor,
	context: SyncProjectContext,
	notice: { moved: MovedNotice } | { deleted: DeletedNotice },
	storeOptions: StoreOperationOptions
): Promise<void> {
	await upsertProjectPlacements(
		[
			{
				projectId: context.projectId,
				locationId: null,
				folderName: null,
				needsLocationChoice: false,
				...notice,
			},
		],
		storeOptions
	);
	await db
		.deleteFrom('sync_file_fingerprints')
		.where('target_id', '=', context.connectionId)
		.where('project_id', '=', context.projectId)
		.execute();
}

function isTeiDocumentFile(path: string, teiPrimaryPaths: ReadonlySet<string>): boolean {
	const file = classifyDocumentPath(path, teiPrimaryPaths);
	return (
		(file?.role === 'canonical' || file?.role === 'version') &&
		documentStorageOfPath(path) === 'tei'
	);
}

async function keepingFingerprints(
	db: Kysely<Database>,
	rebuild: () => Promise<unknown>
): Promise<void> {
	const fingerprints = await db.selectFrom('sync_file_fingerprints').selectAll().execute();
	await rebuild();
	const projectIds = new Set(
		(await db.selectFrom('projects').select('id').execute()).map(project => project.id)
	);
	const kept = fingerprints.filter(fingerprint => projectIds.has(fingerprint.project_id));
	for (let start = 0; start < kept.length; start += 50) {
		await db
			.insertInto('sync_file_fingerprints')
			.values(kept.slice(start, start + 50))
			.onConflict(conflict => conflict.doNothing())
			.execute();
	}
}

async function writePulledMirrorFile(
	projectRoot: string,
	remoteFile: RemoteMirrorFile,
	storeOptions: StoreOperationOptions
): Promise<LocalMirrorFile> {
	const storePath = joinStorePath(projectRoot, remoteFile.path);
	const content = await remoteContent(remoteFile);
	await writeProjectFileAtomic(storePath, content, storeOptions);
	return {
		path: remoteFile.path,
		storePath,
		content: loaded(content),
		fingerprint: await storedFingerprint(content, await statFile(storePath, storeOptions)),
	};
}

async function readLocalMirrorFile(
	projectRoot: string,
	path: string,
	storeOptions: StoreOperationOptions
): Promise<LocalMirrorFile | null> {
	const storePath = joinStorePath(projectRoot, path);
	try {
		const stat = await statFile(storePath, storeOptions);
		const content = await readTextFile(storePath, storeOptions);
		return {
			path,
			storePath,
			content: loaded(content),
			fingerprint: await storedFingerprint(content, stat),
		};
	} catch (error) {
		if (isMissingStoreEntryError(error)) return null;
		throw error;
	}
}

async function storedFingerprint(
	content: ProjectFileContent,
	stat: StoreFileStat
): Promise<FileFingerprint> {
	const { contentHash } = await fingerprintContent(content, '');
	return { contentHash, size: stat.size, modifiedAt: statModifiedAt(stat) };
}

async function deleteStoreDirectoryIfExists(
	path: string,
	storeOptions: StoreOperationOptions
): Promise<void> {
	try {
		await deleteDirectory(path, { ...storeOptions, recursive: true });
	} catch (error) {
		if (!isMissingStoreEntryError(error)) throw error;
	}
}

async function deleteStoreFileIfExists(
	path: string,
	storeOptions: StoreOperationOptions
): Promise<void> {
	try {
		await deleteFile(path, storeOptions);
	} catch (error) {
		if (!isMissingStoreEntryError(error)) throw error;
	}
}

function storeQuarantineForSync(record: StoreQuarantineRecord): SyncQuarantine {
	return {
		path: record.path,
		code: record.code,
		message: record.message,
		expected: record.expected,
		actual: record.actual,
	};
}

async function getFileFingerprint(
	db: DbExecutor,
	context: SyncProjectContext,
	filePath: string
): Promise<SyncFileFingerprintRecord | null> {
	const row = await db
		.selectFrom('sync_file_fingerprints')
		.selectAll()
		.where('target_id', '=', context.connectionId)
		.where('project_id', '=', context.projectId)
		.where('file_path', '=', filePath)
		.executeTakeFirst();
	return row ? mapSyncFileFingerprint(row) : null;
}

export async function recordSyncedFile(
	db: DbExecutor,
	context: SyncProjectContext,
	file: { path: string; storePath: string; content: ProjectFileContent },
	remote: CloudFileMetadata,
	syncedAt: string
): Promise<void> {
	const fingerprint = await fingerprintContent(file.content, '');
	await upsertFileFingerprint(
		db,
		context,
		{ ...file, content: loaded(file.content), fingerprint },
		remote,
		fingerprint,
		syncedAt
	);
}

async function upsertFileFingerprint(
	db: DbExecutor,
	context: SyncProjectContext,
	localFile: LocalMirrorFile,
	remote: CloudFileMetadata | CloudWriteResult,
	remoteFingerprint: FileFingerprint,
	syncedAt: string,
	knownEntity?: EntityHead
): Promise<void> {
	const entity = knownEntity ?? (await mirrorPathEntityHead(db, localFile.path));
	await db
		.insertInto('sync_file_fingerprints')
		.values({
			target_id: context.connectionId,
			project_id: context.projectId,
			file_path: localFile.path,
			local_content_hash: localFile.fingerprint.contentHash,
			local_size: localFile.fingerprint.size,
			local_modified_at: localFile.fingerprint.modifiedAt,
			remote_file_id: remote.id,
			remote_revision: remote.revision,
			remote_content_hash: remoteFingerprint.contentHash,
			remote_size: remote.size,
			remote_modified_at: remote.modifiedAt,
			synced_at: syncedAt,
			entity_type: entity.entityType,
			entity_id: entity.entityId,
			revision_id: entity.revisionId,
			entity_content_hash: entity.contentHash,
		})
		.onConflict(oc =>
			oc.columns(['target_id', 'project_id', 'file_path']).doUpdateSet({
				local_content_hash: localFile.fingerprint.contentHash,
				local_size: localFile.fingerprint.size,
				local_modified_at: localFile.fingerprint.modifiedAt,
				remote_file_id: remote.id,
				remote_revision: remote.revision,
				remote_content_hash: remoteFingerprint.contentHash,
				remote_size: remote.size,
				remote_modified_at: remote.modifiedAt,
				synced_at: syncedAt,
				entity_type: entity.entityType,
				entity_id: entity.entityId,
				revision_id: entity.revisionId,
				entity_content_hash: entity.contentHash,
			})
		)
		.execute();
}

async function mirrorPathEntityHead(db: DbExecutor, path: string): Promise<EntityHead> {
	const file = classifyDocumentPath(path);
	const teiPrimary =
		file?.role === 'unlisted' &&
		(file.kind === 'transcription'
			? await getTranscriptionContentHash(db, file.entityId)
			: await getCollationContentHash(db, file.entityId)) !== null;
	const reference = primaryReferenceForMirrorPath(path, teiPrimary ? new Set([path]) : undefined);
	if (reference?.entityType === 'project-transcription') {
		const entityId = reference.entityId;
		const row = await db
			.selectFrom('project_transcriptions')
			.innerJoin(
				'transcriptions',
				'transcriptions.id',
				'project_transcriptions.transcription_id'
			)
			.select([
				'transcriptions.current_revision_id as revision_id',
				'transcriptions.current_content_hash as content_hash',
			])
			.where('project_transcriptions.id', '=', entityId)
			.executeTakeFirst();
		return {
			entityType: 'project-transcription',
			entityId,
			revisionId: row?.revision_id ?? '',
			contentHash: row?.content_hash ?? '',
		};
	}
	if (reference?.entityType === 'collation') {
		const entityId = reference.entityId;
		const row = await db
			.selectFrom('collations')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', entityId)
			.executeTakeFirst();
		return {
			entityType: 'collation',
			entityId,
			revisionId: row?.current_revision_id ?? '',
			contentHash: row?.current_content_hash ?? '',
		};
	}
	return { entityType: '', entityId: '', revisionId: '', contentHash: '' };
}

function mapSyncFileFingerprint(row: Selectable<SyncFileFingerprints>): SyncFileFingerprintRecord {
	return {
		targetId: row.target_id,
		projectId: row.project_id,
		filePath: row.file_path,
		localContentHash: row.local_content_hash,
		localSize: row.local_size,
		localModifiedAt: row.local_modified_at,
		remoteFileId: row.remote_file_id,
		remoteRevision: row.remote_revision,
		remoteContentHash: row.remote_content_hash,
		remoteSize: row.remote_size,
		remoteModifiedAt: row.remote_modified_at,
		syncedAt: row.synced_at,
		entityType: row.entity_type,
		entityId: row.entity_id,
		revisionId: row.revision_id,
		entityContentHash: row.entity_content_hash,
	};
}

const SYNC_ENTITY_TYPES: Record<DocumentKind, SyncEntityType> = {
	transcription: 'project-transcription',
	collation: 'collation',
};

function primaryReferenceForMirrorPath(
	path: string,
	teiPrimaryPaths?: ReadonlySet<string>
): SyncEntityReference | null {
	const file = classifyDocumentPath(path, teiPrimaryPaths);
	return file?.role === 'canonical'
		? { entityType: SYNC_ENTITY_TYPES[file.kind], entityId: file.entityId }
		: null;
}

function cbgmAnalysisIdForPath(path: string): string | undefined {
	return /^cbgm\/([^/]+?)\.(?:json|input\.xml|sqlite|global-stemma\.dot)$/.exec(path)?.[1];
}

async function resolveDivergentFile(
	path: string,
	localContent: string,
	remoteContent: string,
	teiPrimaryPaths: ReadonlySet<string>
): Promise<'local' | 'remote' | null> {
	const role = classifyDocumentPath(path, teiPrimaryPaths)?.role;
	if (role !== 'canonical' && role !== 'version') return null;
	const [local, remote] = await Promise.all([
		teiContentHash(localContent),
		teiContentHash(remoteContent),
	]);
	return local === remote ? 'remote' : null;
}

function manifestTeiPrimaryPaths(content: ProjectFileContent | null | undefined): Set<string> {
	if (typeof content !== 'string') return new Set();
	const manifest = parseJsonRecord(content);
	return Array.isArray(manifest?.transcriptions) && Array.isArray(manifest.collations)
		? teiPrimaryPathsOfManifest(
				manifest as unknown as Parameters<typeof teiPrimaryPathsOfManifest>[0]
			)
		: new Set();
}

function parseJsonRecord(content: string): Record<string, unknown> | null {
	try {
		const value = JSON.parse(content) as unknown;
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function isConflictCopyFile(
	path: string,
	entityType: SyncEntityType,
	entityId: string,
	teiPrimaryPaths: ReadonlySet<string>
): boolean {
	const file = classifyDocumentPath(path, teiPrimaryPaths);
	return (
		(file?.role === 'canonical' || file?.role === 'version') &&
		SYNC_ENTITY_TYPES[file.kind] === entityType &&
		file.entityId === entityId
	);
}

function mirrorWriteOrder(path: string): number {
	if (path.startsWith('tombstones/')) return 0;
	if (classifyDocumentPath(path)?.role === 'version') return 1;
	if (path === 'project.json') return 3;
	return 2;
}

async function createConflictCopy(
	db: Kysely<Database>,
	local: LocalEntityState,
	options: SyncManagerOptions
): Promise<string> {
	if (local.entityType === 'project-transcription') {
		const copy = await createProjectTranscriptionConflictCopy(db, {
			projectTranscriptionId: local.entityId,
			actorName: options.authorName,
			now: options.now?.(),
		});
		await db.transaction().execute(async trx => {
			await trx
				.deleteFrom('transcription_checkpoints')
				.where('id', '=', copy.currentRevisionId)
				.execute();
			await trx
				.updateTable('transcriptions')
				.set({ current_revision_id: '', current_content_hash: '' })
				.where('id', '=', copy.transcriptionId)
				.execute();
			await createCommittedTranscriptionCheckpointWithFiles(
				trx,
				{
					projectTranscriptionId: copy.projectTranscriptionId,
					checkpointId: copy.currentRevisionId,
					commitMessage: 'Conflicted copy',
					authorName: options.authorName,
					createdAt: options.now?.(),
				},
				options.storeOptions
			);
		});
		return copy.projectTranscriptionId;
	}
	const source = await loadCommittedCollationPayloadWithFiles(
		db,
		local.entityId,
		options.storeOptions
	);
	const copy = await createCollationConflictCopy(db, {
		collationId: local.entityId,
		actorName: options.authorName,
		now: options.now?.(),
	});
	await db.transaction().execute(async trx => {
		await trx
			.deleteFrom('collation_checkpoints')
			.where('id', '=', copy.currentRevisionId)
			.execute();
		await trx
			.updateTable('collations')
			.set({ current_revision_id: '', current_content_hash: '' })
			.where('id', '=', copy.collationId)
			.execute();
		await saveWorkingCollationArtifact(
			trx,
			{
				collationId: copy.collationId,
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(source.document),
				now: options.now?.(),
			},
			options.storeOptions
		);
		await createCommittedCollationCheckpointWithFiles(
			trx,
			{
				collationId: copy.collationId,
				checkpointId: copy.currentRevisionId,
				commitMessage: 'Conflicted copy',
				authorName: options.authorName,
				createdAt: options.now?.(),
			},
			options.storeOptions
		);
	});
	return copy.collationId;
}

function mergeOperationResult(target: SyncOperationResult, source: SyncOperationResult): void {
	target.uploadedPaths.push(...source.uploadedPaths);
	target.downloadedPaths.push(...source.downloadedPaths);
	target.deletedPaths.push(...source.deletedPaths);
	target.quarantines.push(...source.quarantines);
	if (source.conflictCopyId) target.conflictCopyId = source.conflictCopyId;
	if (source.moved) target.moved = source.moved;
	if (source.deleted) target.deleted = source.deleted;
	if (source.draftCheckpointId) target.draftCheckpointId = source.draftCheckpointId;
	if (source.providerError) target.providerError = source.providerError;
	if (source.providerMessage) target.providerMessage = source.providerMessage;
}

function hasOperationFailure(result: SyncOperationResult): boolean {
	return Boolean(result.providerError) || result.quarantines.length > 0;
}

async function listRemoteMetadata(
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	prefix = ''
): Promise<{ entries: CloudFileMetadata[]; cursor?: string }> {
	let cursor: string | undefined;
	let page: CloudListResult;
	const entries: CloudFileMetadata[] = [];
	do {
		page = await provider.listFiles(context.cloudFolderId, { recursive: true, cursor });
		entries.push(...page.entries.filter(entry => !entry.isFolder && !entry.isDeleted));
		cursor = page.cursor;
	} while (page.hasMore && cursor);
	return {
		entries: prefix
			? entries.filter(entry => relativeEntryPath(entry.path, context).startsWith(prefix))
			: entries,
		cursor,
	};
}

function relativeEntryPath(path: string, context: SyncProjectContext): string {
	const normalizedPath = normalizeSlashes(path);
	const root = normalizeSlashes(context.cloudFolderPath ?? '');
	if (root && normalizedPath === root) return '';
	if (root && normalizedPath.startsWith(`${root}/`)) return normalizedPath.slice(root.length + 1);
	return normalizedPath.replace(/^\/+/, '');
}

function providerRootFolderId(provider: CloudStorageProvider): string {
	if ('rootFolderId' in provider && typeof provider.rootFolderId === 'string') {
		return provider.rootFolderId;
	}
	if ('rootPath' in provider && typeof provider.rootPath === 'string') {
		return provider.rootPath;
	}
	return '';
}

function baseResult(
	uiState: SyncUiState,
	entityType?: SyncEntityType,
	entityId?: string
): SyncOperationResult {
	return {
		uiState,
		entityType,
		entityId,
		uploadedPaths: [],
		downloadedPaths: [],
		deletedPaths: [],
		quarantines: [],
	};
}

function quarantineFor(path: string, quarantine: StoreQuarantineReason): SyncQuarantine {
	return {
		path,
		code: quarantine.code,
		message: quarantine.message,
		expected: quarantine.expected,
		actual: quarantine.actual,
	};
}
