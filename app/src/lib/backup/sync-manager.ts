import type { Kysely, Selectable } from 'kysely';
import type { Database, SyncFileFingerprints } from '$lib/db/types.generated';
import {
	createCommittedCollationCheckpointWithFiles,
	loadCommittedCollationPayloadWithFiles,
	saveWorkingCollationArtifact,
} from '$lib/db/repositories/collation-files';
import { createCommittedTranscriptionCheckpointWithFiles } from '$lib/db/repositories/transcription-files';
import {
	canonicalFormatForProjectPath,
	readCanonicalDocument,
	transcriptionDocumentToTeiFromStore,
	TOMBSTONE_FORMAT,
	type TombstonePayload,
	type CollationPayload,
	type ProjectTranscriptionPayload,
} from '$lib/storage/formats';
import {
	deleteFile,
	listDirectory,
	readTextFile,
	writeTextFileAtomic,
	type StoreDirectoryEntry,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import { joinStorePath } from '$lib/storage/layout';
import {
	upsertProjectPlacements,
	type DeletedNotice,
	type MovedNotice,
} from '$lib/storage/project-locations';
import { canonicalJson } from '$lib/storage/canonical-json';
import type { StoreQuarantineRecord, StoreQuarantineReason } from '$lib/storage/quarantine';
import { ApparatusExportError, exportCollationDocumentTei } from '$lib/collation/collation-tei';
import {
	rebuildIndexFromStore,
	restoreOrphanPrimaryToProject,
} from '$lib/db/repositories/index-rebuild';
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
	type CloudProviderErrorCode,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './providers/provider';
import type { DbExecutor } from '$lib/db/worker-kysely';
import { validateProjectFilesWithTemporaryStaging } from './project-file-staging';
import { loadLocalEntity, primaryPathFor, type LocalEntityState } from './backup-summary';
import {
	loadProjectStoreRoot,
	isMissingStoreEntryError,
	shouldMirrorProjectFile,
	normalizeSlashes,
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
}

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
}

interface FileFingerprint {
	contentHash: string;
	size: number;
	modifiedAt: string;
}

interface LocalMirrorFile {
	path: string;
	storePath: string;
	content: string;
	fingerprint: FileFingerprint;
}

interface RemoteMirrorFile {
	path: string;
	metadata: CloudFileMetadata;
	content: string;
	fingerprint: FileFingerprint;
}

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
	const backupContext = await ensureProjectBackupFolder(provider, context);
	const result: ProjectBackupResult = {
		...baseResult('sync pending'),
		projectId: backupContext.projectId,
		manifestUploaded: false,
		entityResults: [],
	};

	const mirrorResult = await mirrorProjectFiles(db, provider, backupContext, options);
	mergeOperationResult(result, mirrorResult);
	result.entityResults.push(mirrorResult);
	if (result.moved || result.deleted) {
		result.uiState = 'saved locally';
		return result;
	}
	result.manifestUploaded = !hasOperationFailure(mirrorResult);
	result.hasConflictCopies = (await listConflictCopies(db, backupContext.projectId)).length > 0;

	if (result.manifestUploaded && !hasOperationFailure(result)) {
		result.uiState = 'synced';
		return result;
	}

	result.uiState =
		result.quarantines.length > 0 ? 'conflict requires resolution' : 'sync pending';
	return result;
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

async function mirrorProjectFiles(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	options: SyncManagerOptions = {}
): Promise<SyncOperationResult> {
	const result = baseResult('sync pending');
	const now = options.now?.() ?? new Date().toISOString();
	const storeOptions = options.storeOptions ?? {};
	try {
		const remoteMetadata = await listRemoteMetadata(provider, context);
		const movedEntry = remoteMetadata.find(
			entry => relativeEntryPath(entry.path, context) === MOVED_MARKER_FILE
		);
		if (movedEntry) {
			result.moved = parseMovedMarker(await provider.downloadFile(movedEntry.id));
			await markProjectRetired(db, context, { moved: result.moved }, storeOptions);
			return result;
		}
		const deletedEntry = remoteMetadata.find(
			entry => relativeEntryPath(entry.path, context) === DELETED_MARKER_FILE
		);
		if (deletedEntry) {
			result.deleted = parseDeletedMarker(await provider.downloadFile(deletedEntry.id));
			await markProjectRetired(db, context, { deleted: result.deleted }, storeOptions);
			return result;
		}
		const projectRoot = await loadProjectStoreRoot(db, context.projectId);
		let [localFiles, remoteFiles] = await Promise.all([
			listLocalProjectMirrorFiles(db, context.projectId, storeOptions),
			downloadRemoteMirrorFiles(provider, context, remoteMetadata),
		]);
		const pulledFiles: Array<{ localFile: LocalMirrorFile; remoteFile: RemoteMirrorFile }> = [];
		const remoteOnlyPrimaryPaths: string[] = [];
		const tombstonedPrimaryPaths = new Set<string>();
		const conflicts: Array<{ reference: SyncEntityReference; remoteFile: RemoteMirrorFile }> =
			[];
		const conflictingRemotePrimaries = new Map<string, RemoteMirrorFile>();
		let pulledTombstone = false;

		for (const localFile of localFiles.filter(file => file.path.startsWith('tombstones/'))) {
			const parsed = await readCanonicalDocument<TombstonePayload>(
				TOMBSTONE_FORMAT,
				localFile.content
			);
			if (!parsed.ok) {
				result.quarantines.push(quarantineFor(localFile.path, parsed.quarantine));
				continue;
			}
			tombstonedPrimaryPaths.add(parsed.payload.cloud_path);
			const remoteFile = remoteFiles.get(localFile.path) ?? null;
			let write: CloudFileMetadata | CloudWriteResult;
			if (!remoteFile) {
				write = await provider.createFile(
					context.cloudFolderId,
					localFile.path,
					localFile.content
				);
				result.uploadedPaths.push(localFile.path);
			} else if (remoteFile.fingerprint.contentHash !== localFile.fingerprint.contentHash) {
				write = await provider.updateFile(
					remoteFile.metadata.id,
					localFile.content,
					remoteFile.metadata.revision
				);
				result.uploadedPaths.push(localFile.path);
			} else {
				write = remoteFile.metadata;
			}
			await upsertFileFingerprint(db, context, localFile, write, localFile.fingerprint, now);

			const remotePrimary = remoteFiles.get(parsed.payload.cloud_path);
			if (remotePrimary) {
				await provider.deleteFile(
					remotePrimary.metadata.id,
					provider.capabilities.supportsExpectedRevisionDelete
						? remotePrimary.metadata.revision
						: undefined
				);
				remoteFiles.delete(parsed.payload.cloud_path);
				result.deletedPaths.push(parsed.payload.cloud_path);
			}
		}

		for (const remoteFile of [...remoteFiles.values()].filter(file =>
			file.path.startsWith('tombstones/')
		)) {
			if (localFiles.some(file => file.path === remoteFile.path)) continue;
			const validation = await validateProjectFilesWithTemporaryStaging(
				[{ path: remoteFile.path, content: remoteFile.content }],
				{ projectId: context.projectId, storeOptions }
			);
			if (validation.quarantinedFiles.length) {
				result.quarantines.push(...validation.quarantinedFiles.map(storeQuarantineForSync));
				continue;
			}
			const parsed = await readCanonicalDocument<TombstonePayload>(
				TOMBSTONE_FORMAT,
				remoteFile.content
			);
			if (!parsed.ok) {
				result.quarantines.push(quarantineFor(remoteFile.path, parsed.quarantine));
				continue;
			}
			tombstonedPrimaryPaths.add(parsed.payload.cloud_path);
			const pulledLocalFile = await writePulledMirrorFile(
				projectRoot,
				remoteFile,
				storeOptions
			);
			await deleteStoreFileIfExists(
				joinStorePath(projectRoot, parsed.payload.cloud_path),
				storeOptions
			);
			await deleteStoreFileIfExists(
				joinStorePath(
					projectRoot,
					parsed.payload.cloud_path.replace(/\.json$/, '.tei.xml')
				),
				storeOptions
			);
			pulledFiles.push({ localFile: pulledLocalFile, remoteFile });
			result.downloadedPaths.push(remoteFile.path);
			pulledTombstone = true;
			const remotePrimary = remoteFiles.get(parsed.payload.cloud_path);
			if (remotePrimary) {
				await provider.deleteFile(
					remotePrimary.metadata.id,
					provider.capabilities.supportsExpectedRevisionDelete
						? remotePrimary.metadata.revision
						: undefined
				);
				remoteFiles.delete(parsed.payload.cloud_path);
				result.deletedPaths.push(parsed.payload.cloud_path);
			}
		}

		if (pulledTombstone) {
			await keepingFingerprints(db, () => rebuildIndexFromStore(db, storeOptions));
			await writeProjectManifestFile(db, context.projectId, {}, storeOptions);
			localFiles = await listLocalProjectMirrorFiles(db, context.projectId, storeOptions);
		}

		const localPaths = new Set(localFiles.map(file => file.path));
		for (const localFile of localFiles) {
			if (
				localFile.path === 'project.json' ||
				localFile.path.startsWith('tombstones/') ||
				localFile.path.endsWith('.tei.xml')
			)
				continue;
			const remoteFile = remoteFiles.get(localFile.path) ?? null;
			const cached = await getFileFingerprint(db, context, localFile.path);
			if (!remoteFile) {
				const write = await provider.createFile(
					context.cloudFolderId,
					localFile.path,
					localFile.content
				);
				result.uploadedPaths.push(localFile.path);
				await upsertFileFingerprint(
					db,
					context,
					localFile,
					write,
					localFile.fingerprint,
					now
				);
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
			const winner =
				localUnchanged && !remoteUnchanged
					? 'remote'
					: remoteUnchanged
						? 'local'
						: resolveDivergentFile(
								localFile.path,
								localFile.content,
								remoteFile.content
							);
			if (winner === 'remote') {
				const validation = await validateProjectFilesWithTemporaryStaging(
					[{ path: remoteFile.path, content: remoteFile.content }],
					{ projectId: context.projectId, storeOptions }
				);
				if (validation.quarantinedFiles.length) {
					result.quarantines.push(
						...validation.quarantinedFiles.map(storeQuarantineForSync)
					);
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
				const write = await provider.updateFile(
					remoteFile.metadata.id,
					localFile.content,
					remoteFile.metadata.revision
				);
				result.uploadedPaths.push(localFile.path);
				await upsertFileFingerprint(
					db,
					context,
					localFile,
					write,
					localFile.fingerprint,
					now
				);
				continue;
			}

			const validation = await validateProjectFilesWithTemporaryStaging(
				[{ path: remoteFile.path, content: remoteFile.content }],
				{ projectId: context.projectId, storeOptions }
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
			const reference = primaryReferenceForMirrorPath(localFile.path);
			if (reference) {
				conflicts.push({ reference, remoteFile });
				conflictingRemotePrimaries.set(
					localFile.path.replace(/\.json$/, '.tei.xml'),
					remoteFile
				);
			}
		}

		for (const remoteFile of [...remoteFiles.values()].sort((left, right) =>
			left.path.localeCompare(right.path)
		)) {
			if (localPaths.has(remoteFile.path)) continue;
			if (
				remoteFile.path === 'project.json' ||
				remoteFile.path.startsWith('tombstones/') ||
				remoteFile.path.endsWith('.tei.xml') ||
				tombstonedPrimaryPaths.has(remoteFile.path)
			)
				continue;
			const validation = await validateProjectFilesWithTemporaryStaging(
				[{ path: remoteFile.path, content: remoteFile.content }],
				{ projectId: context.projectId, storeOptions }
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
			if (primaryReferenceForMirrorPath(remoteFile.path)) {
				remoteOnlyPrimaryPaths.push(joinStorePath(projectRoot, remoteFile.path));
			}
			result.downloadedPaths.push(remoteFile.path);
		}

		const conflictFingerprints: Array<() => Promise<void>> = [];
		for (const { reference, remoteFile } of conflicts) {
			const local = await loadLocalEntity(db, reference, options.storeOptions);
			const copyId = await createConflictCopy(db, local, options);
			result.conflictCopyId ??= copyId;
			const copyFiles = (
				await listLocalProjectMirrorFiles(db, context.projectId, storeOptions)
			).filter(file => isConflictCopyFile(file.path, reference.entityType, copyId));
			for (const file of copyFiles) {
				const write = await provider.createFile(
					context.cloudFolderId,
					file.path,
					file.content
				);
				result.uploadedPaths.push(file.path);
				conflictFingerprints.push(() =>
					upsertFileFingerprint(db, context, file, write, file.fingerprint, now)
				);
			}
			pulledFiles.push({
				localFile: await writePulledMirrorFile(projectRoot, remoteFile, storeOptions),
				remoteFile,
			});
			result.downloadedPaths.push(remoteFile.path);
		}
		if (pulledFiles.length > 0) {
			await keepingFingerprints(db, async () => {
				await rebuildIndexFromStore(db, storeOptions);
				for (const path of remoteOnlyPrimaryPaths) {
					await restoreOrphanPrimaryToProject(db, path, storeOptions);
				}
			});
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
		for (const upsert of conflictFingerprints) await upsert();

		const { files: derivedTeiFiles, absentPaths } = await regenerateDerivedTeiFiles(
			projectRoot,
			storeOptions
		);
		for (const path of absentPaths) {
			const remoteFile = remoteFiles.get(path);
			if (!remoteFile) continue;
			await provider.deleteFile(
				remoteFile.metadata.id,
				provider.capabilities.supportsExpectedRevisionDelete
					? remoteFile.metadata.revision
					: undefined
			);
			remoteFiles.delete(path);
			result.deletedPaths.push(path);
		}
		for (const localFile of derivedTeiFiles) {
			const remoteFile = remoteFiles.get(localFile.path) ?? null;
			const conflictingPrimary = conflictingRemotePrimaries.get(localFile.path);
			let remoteContent: string;
			try {
				remoteContent = conflictingPrimary
					? await deriveTeiFromCanonicalPrimary(
							conflictingPrimary.path,
							conflictingPrimary.content,
							context.projectId,
							storeOptions
						)
					: localFile.content;
			} catch (error) {
				if (!(error instanceof ApparatusExportError)) throw error;
				if (remoteFile) {
					await provider.deleteFile(
						remoteFile.metadata.id,
						provider.capabilities.supportsExpectedRevisionDelete
							? remoteFile.metadata.revision
							: undefined
					);
					remoteFiles.delete(localFile.path);
					result.deletedPaths.push(localFile.path);
				}
				continue;
			}
			const remoteFingerprint = await fingerprintText(
				remoteContent,
				remoteFile?.metadata.modifiedAt ?? ''
			);
			if (remoteFile?.fingerprint.contentHash === remoteFingerprint.contentHash) {
				await upsertFileFingerprint(
					db,
					context,
					localFile,
					remoteFile.metadata,
					remoteFingerprint,
					now
				);
				continue;
			}
			const write = remoteFile
				? await provider.updateFile(
						remoteFile.metadata.id,
						remoteContent,
						remoteFile.metadata.revision
					)
				: await provider.createFile(context.cloudFolderId, localFile.path, remoteContent);
			result.uploadedPaths.push(localFile.path);
			await upsertFileFingerprint(db, context, localFile, write, remoteFingerprint, now);
		}

		await writeProjectManifestFile(db, context.projectId, {}, storeOptions);
		const manifestFile = (
			await listLocalProjectMirrorFiles(db, context.projectId, storeOptions)
		).find(file => file.path === 'project.json');
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
				const write = remoteManifest
					? await provider.updateFile(
							remoteManifest.metadata.id,
							manifestFile.content,
							remoteManifest.metadata.revision
						)
					: await provider.createFile(
							context.cloudFolderId,
							manifestFile.path,
							manifestFile.content
						);
				result.uploadedPaths.push(manifestFile.path);
				await upsertFileFingerprint(
					db,
					context,
					manifestFile,
					write,
					manifestFile.fingerprint,
					now
				);
			}
		}

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

export async function listPendingUploadPaths(
	db: DbExecutor,
	context: SyncProjectContext,
	storeOptions: StoreOperationOptions = {}
): Promise<string[]> {
	const [localFiles, synced] = await Promise.all([
		listLocalProjectMirrorFiles(db, context.projectId, storeOptions),
		db
			.selectFrom('sync_file_fingerprints')
			.select(['file_path', 'local_content_hash'])
			.where('target_id', '=', context.connectionId)
			.where('project_id', '=', context.projectId)
			.execute(),
	]);
	const syncedHashes = new Map(synced.map(row => [row.file_path, row.local_content_hash]));
	return localFiles
		.filter(file => syncedHashes.get(file.path) !== file.fingerprint.contentHash)
		.map(file => file.path);
}

async function listLocalProjectMirrorFiles(
	db: DbExecutor,
	projectId: string,
	storeOptions: StoreOperationOptions
): Promise<LocalMirrorFile[]> {
	const root = await loadProjectStoreRoot(db, projectId);
	const files: LocalMirrorFile[] = [];
	await collectLocalMirrorFiles(root, '', files, storeOptions);
	return files.sort(
		(left, right) =>
			mirrorWriteOrder(left.path) - mirrorWriteOrder(right.path) ||
			left.path.localeCompare(right.path)
	);
}

async function collectLocalMirrorFiles(
	storePath: string,
	relativePath: string,
	files: LocalMirrorFile[],
	storeOptions: StoreOperationOptions
): Promise<void> {
	let entries: StoreDirectoryEntry[];
	try {
		entries = await listDirectory(storePath, storeOptions);
	} catch (error) {
		if (isMissingStoreEntryError(error)) return;
		throw error;
	}
	for (const entry of entries) {
		const childRelativePath = joinStorePath(relativePath, entry.name);
		const childStorePath = joinStorePath(storePath, entry.name);
		if (entry.kind === 'directory') {
			await collectLocalMirrorFiles(childStorePath, childRelativePath, files, storeOptions);
			continue;
		}
		if (!shouldMirrorProjectFile(childRelativePath)) continue;
		const content = await readTextFile(childStorePath, storeOptions);
		files.push({
			path: childRelativePath,
			storePath: childStorePath,
			content,
			fingerprint: await fingerprintText(content, ''),
		});
	}
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

async function downloadRemoteMirrorFiles(
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	remoteMetadata: CloudFileMetadata[]
): Promise<Map<string, RemoteMirrorFile>> {
	const remoteFiles = new Map<string, RemoteMirrorFile>();
	for (const metadata of remoteMetadata) {
		const path = relativeEntryPath(metadata.path, context);
		if (!shouldMirrorProjectFile(path)) continue;
		const content = await provider.downloadFile(metadata.id);
		remoteFiles.set(path, {
			path,
			metadata,
			content,
			fingerprint: await fingerprintText(content, metadata.modifiedAt),
		});
	}
	return remoteFiles;
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
	await writeTextFileAtomic(storePath, remoteFile.content, storeOptions);
	return {
		path: remoteFile.path,
		storePath,
		content: remoteFile.content,
		fingerprint: await fingerprintText(remoteFile.content, ''),
	};
}

async function regenerateDerivedTeiFiles(
	projectRoot: string,
	storeOptions: StoreOperationOptions
): Promise<{ files: LocalMirrorFile[]; absentPaths: string[] }> {
	const files: LocalMirrorFile[] = [];
	await collectLocalMirrorFiles(projectRoot, '', files, storeOptions);
	const derived: LocalMirrorFile[] = [];
	const absentPaths: string[] = [];
	for (const primary of files) {
		const transcriptionMatch = /^transcriptions\/([^/]+)\.json$/.exec(primary.path);
		const collationMatch = /^collations\/([^/]+)\.json$/.exec(primary.path);
		if (!transcriptionMatch && !collationMatch) continue;
		const path = primary.path.replace(/\.json$/, '.tei.xml');
		const storePath = joinStorePath(projectRoot, path);
		let content: string;
		try {
			content = await deriveTeiFromCanonicalPrimary(
				primary.path,
				primary.content,
				undefined,
				storeOptions
			);
		} catch (error) {
			if (!(error instanceof ApparatusExportError)) throw error;
			await deleteStoreFileIfExists(storePath, storeOptions);
			absentPaths.push(path);
			continue;
		}
		await writeTextFileAtomic(storePath, content, storeOptions);
		derived.push({
			path,
			storePath,
			content,
			fingerprint: await fingerprintText(content, ''),
		});
	}
	return { files: derived, absentPaths };
}

async function deriveTeiFromCanonicalPrimary(
	path: string,
	content: string,
	projectId?: string,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const format = canonicalFormatForProjectPath(path);
	if (!format) throw new Error(`No canonical format is registered for ${path}.`);
	const parsed = await readCanonicalDocument<ProjectTranscriptionPayload | CollationPayload>(
		format,
		content,
		{ projectPath: path, projectId }
	);
	if (!parsed.ok)
		throw new Error(`Could not derive TEI from ${path}: ${parsed.quarantine.message}`);
	return path.startsWith('transcriptions/')
		? transcriptionDocumentToTeiFromStore(
				parsed.payload as ProjectTranscriptionPayload,
				storeOptions
			)
		: exportCollationDocumentTei((parsed.payload as CollationPayload).document);
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

async function upsertFileFingerprint(
	db: DbExecutor,
	context: SyncProjectContext,
	localFile: LocalMirrorFile,
	remote: CloudFileMetadata | CloudWriteResult,
	remoteFingerprint: FileFingerprint,
	syncedAt: string
): Promise<void> {
	const entity = await mirrorPathEntityHead(db, localFile.path);
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

async function mirrorPathEntityHead(
	db: DbExecutor,
	path: string
): Promise<{ entityType: string; entityId: string; revisionId: string; contentHash: string }> {
	const transcriptionMatch = /^transcriptions\/([^/]+)\.json$/.exec(path);
	if (transcriptionMatch) {
		const entityId = transcriptionMatch[1];
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
	const collationMatch = /^collations\/([^/]+)\.json$/.exec(path);
	if (collationMatch) {
		const entityId = collationMatch[1];
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

function primaryReferenceForMirrorPath(path: string): SyncEntityReference | null {
	const transcriptionMatch = /^transcriptions\/([^/]+)\.json$/.exec(path);
	if (transcriptionMatch) {
		return { entityType: 'project-transcription', entityId: transcriptionMatch[1] };
	}
	const collationMatch = /^collations\/([^/]+)\.json$/.exec(path);
	if (collationMatch) return { entityType: 'collation', entityId: collationMatch[1] };
	return null;
}

function resolveDivergentFile(
	path: string,
	localContent: string,
	remoteContent: string
): 'local' | 'remote' | null {
	const local = parseJsonRecord(localContent);
	const remote = parseJsonRecord(remoteContent);
	if (!local || !remote) return null;
	if (path.startsWith('history/')) {
		if (
			local.checkpoint_id !== remote.checkpoint_id ||
			local.payload_content_hash !== remote.payload_content_hash
		)
			return null;
		return String(local.metadata_updated_at ?? '') > String(remote.metadata_updated_at ?? '')
			? 'local'
			: 'remote';
	}
	if (!primaryReferenceForMirrorPath(path)) return null;
	const withoutBase = ({
		based_on_checkpoint: _basedOn,
		content_hash: _hash,
		...rest
	}: Record<string, unknown>) => canonicalJson(rest);
	return withoutBase(local) === withoutBase(remote) ? 'remote' : null;
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

function isConflictCopyFile(path: string, entityType: SyncEntityType, entityId: string): boolean {
	const primary = primaryPathFor(entityType, entityId);
	const historyFolder =
		entityType === 'project-transcription'
			? `history/transcriptions/${entityId}/`
			: `history/collations/${entityId}/`;
	return path === primary || path.startsWith(historyFolder);
}

function mirrorWriteOrder(path: string): number {
	if (path.startsWith('tombstones/')) return 0;
	if (path.startsWith('history/')) return 1;
	if (path === 'project.json') return 3;
	return 2;
}

async function fingerprintText(content: string, modifiedAt: string): Promise<FileFingerprint> {
	return {
		contentHash: await hashText(content),
		size: new TextEncoder().encode(content).byteLength,
		modifiedAt,
	};
}

export async function hashText(content: string): Promise<string> {
	const digest = await globalThis.crypto?.subtle?.digest(
		'SHA-256',
		new TextEncoder().encode(content)
	);
	if (!digest) throw new Error('SHA-256 hashing is unavailable.');
	return `sha256:${[...new Uint8Array(digest)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')}`;
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
): Promise<CloudFileMetadata[]> {
	let cursor: string | undefined;
	const entries: CloudFileMetadata[] = [];
	do {
		const page = await provider.listFiles(context.cloudFolderId, { recursive: true, cursor });
		entries.push(...page.entries.filter(entry => !entry.isFolder && !entry.isDeleted));
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return prefix
		? entries.filter(entry => relativeEntryPath(entry.path, context).startsWith(prefix))
		: entries;
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
