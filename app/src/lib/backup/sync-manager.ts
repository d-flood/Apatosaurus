import type { Kysely, Selectable } from 'kysely';
import type { Database, SyncFileFingerprints } from '$lib/db/types.generated';
import {
	createCommittedCollationCheckpointWithFiles,
	saveWorkingCollationArtifact,
} from '$lib/db/repositories/collation-files';
import { createCommittedTranscriptionCheckpointWithFiles } from '$lib/db/repositories/transcription-files';
import {
	canonicalFormatForProjectPath,
	readCanonicalDocument,
	transcriptionDocumentToTeiFromStore,
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
import type { StoreQuarantineRecord } from '$lib/storage/quarantine';
import { ApparatusExportError, exportCollationDocumentTei } from '$lib/collation/collation-tei';
import {
	rebuildIndexFromStore,
	restoreOrphanPrimaryToProject,
} from '$lib/db/repositories/index-rebuild';
import { writeProjectManifestFile } from '$lib/db/repositories/project-files';
import {
	createCollationConflictCopy,
	createProjectTranscriptionConflictCopy,
	type SyncEntityHead,
} from './conflicts';
import type { SyncEntityReference, SyncEntityType, SyncProjectContext } from './backup-status';
import {
	parseCollationCloudFile,
	parseTombstoneCloudFile,
	serializeCloudFile,
	serializeCollationCloudFile,
	serializeProjectTranscriptionCloudFile,
	type CloudFileQuarantine,
} from './cloud-files';
import {
	isCloudProviderError,
	type CloudFileMetadata,
	type CloudProviderErrorCode,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './providers/provider';
import type { DbExecutor } from '$lib/db/worker-kysely';
import { validateProjectFilesWithTemporaryStaging } from './project-file-staging';
import {
	deriveProjectBackupSummary,
	loadLocalEntity,
	primaryPathFor,
	type BackupItemState,
	type LocalEntityState,
} from './backup-summary';
import {
	loadProjectStoreRoot,
	isMissingStoreEntryError,
	shouldMirrorProjectFile,
	normalizeSlashes,
} from './project-archive';

export type SyncUiState =
	| 'saved locally'
	| 'uncommitted local changes'
	| 'committed locally'
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
	code: CloudFileQuarantine['code'];
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
	skippedItems: BackupItemState[];
}

export interface ProjectBackupOptions extends SyncManagerOptions {
	strict?: boolean;
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
	options: ProjectBackupOptions = {}
): Promise<ProjectBackupResult> {
	const strict = options.strict ?? true;
	const backupContext = await ensureProjectBackupFolder(provider, context);
	const summary = await deriveProjectBackupSummary(db, backupContext, options.storeOptions);
	const result: ProjectBackupResult = {
		...baseResult('sync pending'),
		projectId: backupContext.projectId,
		manifestUploaded: false,
		entityResults: [],
		skippedItems: [],
	};

	if (strict && summary.blockingItems.length > 0) {
		result.uiState = 'uncommitted local changes';
		result.skippedItems = summary.blockingItems;
		return result;
	}

	const mirrorResult = await mirrorProjectFiles(db, provider, backupContext, options);
	mergeOperationResult(result, mirrorResult);
	result.entityResults.push(mirrorResult);
	result.manifestUploaded = !hasOperationFailure(mirrorResult);

	if (
		result.manifestUploaded &&
		!hasOperationFailure(result) &&
		result.skippedItems.length === 0
	) {
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
		const projectRoot = await loadProjectStoreRoot(db, context.projectId);
		let [localFiles, remoteFiles] = await Promise.all([
			listLocalProjectMirrorFiles(db, context.projectId, storeOptions),
			listRemoteMirrorFiles(provider, context),
		]);
		const pulledFiles: Array<{ localFile: LocalMirrorFile; remoteFile: RemoteMirrorFile }> = [];
		const remoteOnlyPrimaryPaths: string[] = [];
		const tombstonedPrimaryPaths = new Set<string>();
		const conflictReferences: SyncEntityReference[] = [];
		const conflictingRemotePrimaries = new Map<string, RemoteMirrorFile>();
		let pulledTombstone = false;

		for (const localFile of localFiles.filter(file => file.path.startsWith('tombstones/'))) {
			const parsed = await parseTombstoneCloudFile(localFile.content);
			if (!parsed.ok) {
				result.quarantines.push(quarantineFor(localFile.path, parsed.quarantine));
				continue;
			}
			tombstonedPrimaryPaths.add(parsed.value.cloud_path);
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

			const remotePrimary = remoteFiles.get(parsed.value.cloud_path);
			if (remotePrimary) {
				await provider.deleteFile(
					remotePrimary.metadata.id,
					provider.capabilities.supportsExpectedRevisionDelete
						? remotePrimary.metadata.revision
						: undefined
				);
				remoteFiles.delete(parsed.value.cloud_path);
				result.deletedPaths.push(parsed.value.cloud_path);
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
			const parsed = await parseTombstoneCloudFile(remoteFile.content);
			if (!parsed.ok) {
				result.quarantines.push(quarantineFor(remoteFile.path, parsed.quarantine));
				continue;
			}
			tombstonedPrimaryPaths.add(parsed.value.cloud_path);
			const pulledLocalFile = await writePulledMirrorFile(
				projectRoot,
				remoteFile,
				storeOptions
			);
			await deleteStoreFileIfExists(
				joinStorePath(projectRoot, parsed.value.cloud_path),
				storeOptions
			);
			await deleteStoreFileIfExists(
				joinStorePath(projectRoot, parsed.value.cloud_path.replace(/\.json$/, '.tei.xml')),
				storeOptions
			);
			pulledFiles.push({ localFile: pulledLocalFile, remoteFile });
			result.downloadedPaths.push(remoteFile.path);
			pulledTombstone = true;
			const remotePrimary = remoteFiles.get(parsed.value.cloud_path);
			if (remotePrimary) {
				await provider.deleteFile(
					remotePrimary.metadata.id,
					provider.capabilities.supportsExpectedRevisionDelete
						? remotePrimary.metadata.revision
						: undefined
				);
				remoteFiles.delete(parsed.value.cloud_path);
				result.deletedPaths.push(parsed.value.cloud_path);
			}
		}

		if (pulledTombstone) {
			await rebuildIndexFromStore(db, storeOptions);
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
			if (localUnchanged && !remoteUnchanged) {
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
			if (remoteUnchanged) {
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
				conflictReferences.push(reference);
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

		if (pulledFiles.length > 0) {
			await rebuildIndexFromStore(db, storeOptions);
			for (const path of remoteOnlyPrimaryPaths) {
				await restoreOrphanPrimaryToProject(db, path, storeOptions);
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
		for (const reference of conflictReferences) {
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
				await upsertFileFingerprint(db, context, file, write, file.fingerprint, now);
			}
		}

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

async function listLocalProjectMirrorFiles(
	db: DbExecutor,
	projectId: string,
	storeOptions: StoreOperationOptions
): Promise<LocalMirrorFile[]> {
	const root = await loadProjectStoreRoot(db, projectId);
	const files: LocalMirrorFile[] = [];
	await collectLocalMirrorFiles(root, '', files, storeOptions, false);
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
	storeOptions: StoreOperationOptions,
	includeDrafts: boolean
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
			await collectLocalMirrorFiles(
				childStorePath,
				childRelativePath,
				files,
				storeOptions,
				includeDrafts
			);
			continue;
		}
		if (!shouldMirrorProjectFile(childRelativePath, includeDrafts)) continue;
		const content = await readTextFile(childStorePath, storeOptions);
		files.push({
			path: childRelativePath,
			storePath: childStorePath,
			content,
			fingerprint: await fingerprintText(content, ''),
		});
	}
}

async function listRemoteMirrorFiles(
	provider: CloudStorageProvider,
	context: SyncProjectContext
): Promise<Map<string, RemoteMirrorFile>> {
	const remoteFiles = new Map<string, RemoteMirrorFile>();
	for (const metadata of await listRemoteMetadata(provider, context)) {
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
	await collectLocalMirrorFiles(projectRoot, '', files, storeOptions, false);
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

async function hashText(content: string): Promise<string> {
	const digest = await globalThis.crypto?.subtle?.digest(
		'SHA-256',
		new TextEncoder().encode(content)
	);
	if (!digest) throw new Error('SHA-256 hashing is unavailable.');
	return `sha256:${[...new Uint8Array(digest)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')}`;
}

async function serializePrimaryFile(
	db: Kysely<Database>,
	local: LocalEntityState,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	if (local.entityType === 'project-transcription') {
		return serializeCloudFile(await serializeProjectTranscriptionCloudFile(db, local.entityId));
	}
	return serializeCloudFile(await serializeCollationCloudFile(db, local.entityId, storeOptions));
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
	const sourceFile = await parseCollationCloudFile(
		await serializePrimaryFile(db, local, options.storeOptions)
	);
	if (!sourceFile.ok) {
		throw new Error(`Cannot preserve collation conflict: ${sourceFile.quarantine.message}`);
	}
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
				payload: JSON.stringify(sourceFile.value.document),
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

function quarantineFor(path: string, quarantine: CloudFileQuarantine): SyncQuarantine {
	return {
		path,
		code: quarantine.code,
		message: quarantine.message,
		expected: quarantine.expected,
		actual: quarantine.actual,
	};
}
