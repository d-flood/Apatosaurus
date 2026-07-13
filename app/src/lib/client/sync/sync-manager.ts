import type { Kysely, Selectable, Transaction } from 'kysely';

import type {
	CloudSyncMetadata,
	Database,
	IiifCanvasAnnotations,
	IiifManifestSources,
	SyncFileFingerprints,
	TranscriptionPageCanvasLinks,
} from '$lib/client/db/types.generated';
import {
	isTranscriptionDirty,
	type CollationCheckpoint,
	type CommitCollationInput,
	type CommitTranscriptionInput,
	type TranscriptionCheckpoint,
} from '$lib/client/db/repositories/revisions';
import {
	createCommittedCollationCheckpointWithFiles,
	getCollationVersionStatusWithWorkingFile,
} from '$lib/client/db/repositories/collation-files';
import { createCommittedTranscriptionCheckpointWithFiles } from '$lib/client/db/repositories/transcription-files';
import {
	canonicalFormatForProjectPath,
	collationDocumentToTei,
	deleteFile,
	joinStorePath,
	listDirectory,
	projectFolder,
	readTextFile,
	readCanonicalDocument,
	transcriptionDocumentToTei,
	writeTextFileAtomic,
	type CollationPayload,
	type ProjectTranscriptionPayload,
	type StoreDirectoryEntry,
	type StoreOperationOptions,
	type StoreQuarantineRecord,
} from '$lib/client/store';
import { rebuildIndexFromStore } from '$lib/client/db/repositories/index-rebuild';
import { writeProjectManifestFile } from '$lib/client/db/repositories/project-files';
import { loadProjectTranscriptionIds } from '$lib/client/db/repositories/collations';
import { canonicalJson } from './canonical-json';
import {
	classifyCommittedHeadSync,
	createCollationConflictCopy,
	createProjectTranscriptionConflictCopy,
	preserveCollationDraftCheckpoint,
	preserveProjectTranscriptionDraftCheckpoint,
	type SyncEntityHead,
} from './conflicts';
import {
	upsertCloudProjectFolder,
	updateCloudProjectFolderSyncState,
	type CloudProjectFolderRecord,
} from '$lib/client/db/repositories/cloud-connections';
import { deriveEntityCloudBackupState, type EntityCloudBackupState } from './backup-status';
import {
	collationCloudFileToImportInput,
	parseCollationCloudFile,
	parseHistoryCloudFile,
	parseProjectCloudFile,
	parseProjectTranscriptionCloudFile,
	parseTombstoneCloudFile,
	projectRelativeCloudPaths,
	serializeCloudFile,
	serializeCollationCloudFile,
	serializeCollationHistoryCloudFile,
	serializeProjectCloudFile,
	serializeProjectTranscriptionCloudFile,
	serializeProjectTranscriptionHistoryCloudFile,
	validateCollationHeadMatchesCheckpoint,
	validateProjectTranscriptionHeadMatchesCheckpoint,
	type CloudFileQuarantine,
	type CollationCloudFile,
	type HistoryCloudFile,
	type ProjectCloudFile,
	type ProjectTranscriptionCloudFile,
} from './cloud-files';
import {
	CloudProviderError,
	isCloudProviderError,
	type CloudFileMetadata,
	type CloudProviderErrorCode,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './providers/provider';
import { stageAndValidateProjectFiles } from './project-file-staging';

export {
	cloudPathForEntity,
	deriveEntityCloudBackupState,
	type EntityCloudBackupState,
	type EntityCloudBackupStatus,
	type EntityCloudBackupStatusOptions,
} from './backup-status';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type SyncEntityType = 'project-transcription' | 'collation';

export type SyncUiState =
	| 'saved locally'
	| 'uncommitted local changes'
	| 'committed locally'
	| 'sync pending'
	| 'synced'
	| 'remote update available'
	| 'conflict requires resolution';

export interface SyncProjectContext {
	connectionId: string;
	projectId: string;
	cloudFolderId: string;
	cloudFolderPath?: string;
}

export interface SyncEntityReference {
	entityType: SyncEntityType;
	entityId: string;
}

export interface SyncManagerOptions {
	authorName?: string;
	now?: () => string;
	storeOptions?: StoreOperationOptions;
}

export interface SyncQuarantine {
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

export type ProjectBackupItemType = 'project-manifest' | SyncEntityType | 'tombstone';

export type ProjectBackupItemStatus =
	| 'backed-up'
	| 'committed-pending-backup'
	| 'uncommitted-local-changes'
	| 'never-committed'
	| 'remote-update-available'
	| 'diverged'
	| 'unknown';

export type ProjectRemoteManifestState =
	| 'not-checked'
	| 'up-to-date'
	| 'remote-update-available'
	| 'diverged'
	| 'unavailable';

export interface BackupItemState {
	itemType: ProjectBackupItemType;
	itemId: string;
	path: string;
	status: ProjectBackupItemStatus;
	localHead?: SyncEntityHead;
	remoteHead?: SyncEntityHead;
	reason?: string;
}

export interface ProjectManifestComparison {
	state: ProjectRemoteManifestState;
	manifest: ProjectCloudFile | null;
	manifestPath: string;
	downloadedPaths: string[];
	quarantines: SyncQuarantine[];
	providerError?: CloudProviderErrorCode;
	providerMessage?: string;
}

export interface ProjectBackupSummary {
	projectId: string;
	connectionId: string;
	cloudFolderId: string;
	projectManifestState: BackupItemState;
	transcriptions: BackupItemState[];
	collations: BackupItemState[];
	tombstones: BackupItemState[];
	remoteManifestState: ProjectRemoteManifestState;
	blockingItems: BackupItemState[];
	pendingItems: BackupItemState[];
	lastFullySyncedAt: string | null;
}

export interface ProjectBackupResult extends SyncOperationResult {
	projectId: string;
	manifestUploaded: boolean;
	entityResults: SyncOperationResult[];
	skippedItems: BackupItemState[];
}

export interface ProjectBackupOptions extends SyncManagerOptions {
	strict?: boolean;
	folder?: CloudProjectFolderRecord | null;
}

export type OpenObjectPollerConnectionState =
	| 'idle'
	| 'polling'
	| 'backing-off'
	| 'reconnect-required';

export interface OpenObjectSyncPollerOptions {
	poll: () => Promise<SyncOperationResult>;
	baseIntervalMs?: number;
	maxIntervalMs?: number;
	setTimeout?: typeof globalThis.setTimeout;
	clearTimeout?: typeof globalThis.clearTimeout;
}

interface LocalEntityState {
	entityType: SyncEntityType;
	entityId: string;
	projectId: string;
	primaryPath: string;
	head: SyncEntityHead;
	dirty: boolean;
	hasCommittedHead: boolean;
}

export interface ProjectArchiveFile {
	path: string;
	storePath: string;
	content: string;
}

export interface ProjectArchiveFilePath {
	path: string;
	storePath: string;
}

interface RemoteEntityState {
	metadata: CloudFileMetadata;
	primary: ProjectTranscriptionCloudFile | CollationCloudFile;
	historyMetadata: CloudFileMetadata;
	history: HistoryCloudFile;
	head: SyncEntityHead;
}

interface CloudSyncMetadataRecord {
	connectionId: string;
	scopeType: string;
	scopeId: string;
	entityType: string;
	entityId: string;
	cloudFileId: string;
	cloudFileRevision: string;
	cloudPath: string;
	lastSyncedRevision: string;
	lastSyncedHash: string;
	lastSyncedAt: string;
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

const PROJECT_SCOPE_TYPE = 'project';

export async function commitProjectTranscriptionForSync(
	db: Kysely<Database>,
	input: CommitTranscriptionInput,
	options: SyncManagerOptions = {}
): Promise<SyncOperationResult & { checkpoint: TranscriptionCheckpoint }> {
	const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
		db,
		input,
		options.storeOptions
	);
	return {
		...baseResult('sync pending', 'project-transcription', input.projectTranscriptionId),
		checkpoint,
		checkpointId: checkpoint.id,
		localHead: { revisionId: checkpoint.id, contentHash: checkpoint.contentHash },
	};
}

export async function commitCollationForSync(
	db: Kysely<Database>,
	input: CommitCollationInput,
	options: SyncManagerOptions = {}
): Promise<SyncOperationResult & { checkpoint: CollationCheckpoint }> {
	const checkpoint = await createCommittedCollationCheckpointWithFiles(
		db,
		input,
		options.storeOptions
	);
	return {
		...baseResult('sync pending', 'collation', input.collationId),
		checkpoint,
		checkpointId: checkpoint.id,
		localHead: { revisionId: checkpoint.id, contentHash: checkpoint.contentHash },
	};
}

export async function publishEntity(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	reference: SyncEntityReference,
	options: SyncManagerOptions = {}
): Promise<SyncOperationResult> {
	const result = baseResult('sync pending', reference.entityType, reference.entityId);
	let historyUploaded = false;
	try {
		const local = await loadLocalEntity(db, reference, options.storeOptions);
		result.localHead = local.head;
		if (!local.hasCommittedHead) {
			result.uiState = local.dirty ? 'uncommitted local changes' : 'saved locally';
			return result;
		}

		const historyPath = historyPathFor(local.entityType, local.entityId, local.head.revisionId);
		await ensureHistoryFile(
			db,
			provider,
			context,
			local,
			historyPath,
			result,
			options.storeOptions
		);
		historyUploaded = true;

		const primaryContent = await serializePrimaryFile(db, local, options.storeOptions);
		const primaryWrite = await putCloudFile(
			provider,
			context,
			local.primaryPath,
			primaryContent
		);
		result.uploadedPaths.push(local.primaryPath);
		await upsertSyncMetadata(
			db,
			context,
			local,
			primaryWrite,
			options.now?.() ?? new Date().toISOString()
		);
		result.uiState = 'synced';
		result.checkpointId = local.head.revisionId;
		return result;
	} catch (error) {
		if (error instanceof SyncQuarantineError) {
			result.quarantines.push(error.quarantine);
			result.uiState = 'conflict requires resolution';
			return result;
		}
		if (isCloudProviderError(error)) {
			result.providerError = error.code;
			result.providerMessage = error.message;
			result.uiState =
				error.code === 'conflict' && historyUploaded
					? 'conflict requires resolution'
					: 'sync pending';
			return result;
		}
		throw error;
	}
}

export async function pollOpenEntity(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	reference: SyncEntityReference,
	options: SyncManagerOptions = {}
): Promise<SyncOperationResult> {
	const result = baseResult('saved locally', reference.entityType, reference.entityId);
	const local = await loadLocalEntity(db, reference, options.storeOptions);
	result.localHead = local.head;

	const metadata = await getSyncMetadata(db, context, reference);
	const remoteMetadata = await findRemoteMetadata(provider, context, local.primaryPath);
	if (!remoteMetadata) {
		if (local.hasCommittedHead) return publishEntity(db, provider, context, reference, options);
		result.uiState = local.dirty ? 'uncommitted local changes' : 'saved locally';
		return result;
	}

	if (metadata?.cloudFileRevision === remoteMetadata.revision) {
		if (local.dirty) {
			result.uiState = 'uncommitted local changes';
			return result;
		}
		if (!headsEqual(local.head, lastSyncedHead(metadata))) {
			return publishEntity(db, provider, context, reference, options);
		}
		result.uiState = 'synced';
		return result;
	}

	const remote = await downloadRemoteEntity(provider, context, reference, remoteMetadata, result);
	if (!remote) return result;
	result.remoteHead = remote.head;

	const lastSynced = metadata ? lastSyncedHead(metadata) : { revisionId: '', contentHash: '' };
	const classification = metadata
		? classifyCommittedHeadSync({
				localHead: local.head,
				remoteHead: remote.head,
				lastSyncedHead: lastSynced,
			})
		: classifyWithoutMetadata(local, remote.head);

	if (classification === 'in_sync') {
		await upsertSyncMetadataFromRemote(
			db,
			context,
			local,
			remote,
			options.now?.() ?? new Date().toISOString()
		);
		result.uiState = local.dirty ? 'uncommitted local changes' : 'synced';
		return result;
	}

	if (classification === 'local_only_change') {
		return publishEntity(db, provider, context, reference, options);
	}

	if (classification === 'remote_only_change') {
		if (local.dirty) {
			const draft = await preserveLocalDraft(db, local, options);
			result.draftCheckpointId = draft?.checkpointId;
			result.uiState = 'remote update available';
			return result;
		}
		await applyRemoteEntity(db, local, remote);
		await upsertSyncMetadataFromRemote(
			db,
			context,
			local,
			remote,
			options.now?.() ?? new Date().toISOString()
		);
		result.uiState = 'synced';
		return result;
	}

	const conflictCopyId = await createConflictCopy(db, local, options);
	result.conflictCopyId = conflictCopyId;
	result.uiState = 'conflict requires resolution';
	return result;
}

export async function deriveProjectBackupSummary(
	db: Kysely<Database>,
	context: SyncProjectContext,
	folder: CloudProjectFolderRecord | null = null,
	storeOptions: StoreOperationOptions = {}
): Promise<ProjectBackupSummary> {
	const [transcriptionReferences, collationReferences, tombstones] = await Promise.all([
		listProjectTranscriptionReferences(db, context.projectId),
		listProjectCollationReferences(db, context.projectId),
		db
			.selectFrom('sync_tombstones')
			.select(['id', 'entity_type', 'entity_id'])
			.where('project_id', '=', context.projectId)
			.orderBy('id', 'asc')
			.execute(),
	]);
	const [transcriptions, collations] = await Promise.all([
		Promise.all(
			transcriptionReferences.map(reference =>
				deriveEntityBackupItem(db, context, reference, storeOptions)
			)
		),
		Promise.all(
			collationReferences.map(reference =>
				deriveEntityBackupItem(db, context, reference, storeOptions)
			)
		),
	]);
	const tombstoneItems = tombstones.map(row => {
		const id = requireId(row.id, 'tombstone');
		return {
			itemType: 'tombstone' as const,
			itemId: id,
			path: projectRelativeCloudPaths().tombstones(row.entity_type, row.entity_id),
			status: 'committed-pending-backup' as const,
		};
	});
	const items = [...transcriptions, ...collations, ...tombstoneItems];
	const blockingItems = items.filter(isBlockingBackupItem);
	const pendingItems = items.filter(item => item.status === 'committed-pending-backup');
	return {
		projectId: context.projectId,
		connectionId: context.connectionId,
		cloudFolderId: context.cloudFolderId,
		projectManifestState: {
			itemType: 'project-manifest',
			itemId: context.projectId,
			path: projectRelativeCloudPaths().project,
			status:
				pendingItems.length > 0 || blockingItems.length > 0
					? 'committed-pending-backup'
					: 'unknown',
		},
		transcriptions,
		collations,
		tombstones: tombstoneItems,
		remoteManifestState: 'not-checked',
		blockingItems,
		pendingItems,
		lastFullySyncedAt: folder?.lastFullySyncedAt ?? null,
	};
}

export async function publishProjectManifest(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext
): Promise<SyncOperationResult> {
	const result = baseResult('sync pending');
	const path = projectRelativeCloudPaths().project;
	try {
		const manifest = await serializeProjectCloudFile(db, context.projectId);
		await putCloudFile(provider, context, path, await serializeCloudFile(manifest));
		result.uploadedPaths.push(path);
		result.uiState = 'synced';
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

export async function downloadAndCompareProjectManifest(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	storeOptions: StoreOperationOptions = {}
): Promise<ProjectManifestComparison> {
	const manifestPath = projectRelativeCloudPaths().project;
	const result: ProjectManifestComparison = {
		state: 'unavailable',
		manifest: null,
		manifestPath,
		downloadedPaths: [],
		quarantines: [],
	};
	try {
		const metadata = await findRemoteMetadata(provider, context, manifestPath);
		if (!metadata) return { ...result, state: 'not-checked' };
		const content = await provider.downloadFile(metadata.id);
		result.downloadedPaths.push(manifestPath);
		const parsed = await parseProjectCloudFile(content);
		if (!parsed.ok) {
			result.quarantines.push(quarantineFor(manifestPath, parsed.quarantine));
			return { ...result, state: 'unavailable' };
		}
		result.manifest = parsed.value;
		result.state = await compareProjectManifestHeads(db, context, parsed.value, storeOptions);
		return result;
	} catch (error) {
		if (isCloudProviderError(error)) {
			result.providerError = error.code;
			result.providerMessage = error.message;
			return result;
		}
		throw error;
	}
}

export async function backupProject(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	options: ProjectBackupOptions = {}
): Promise<ProjectBackupResult> {
	const strict = options.strict ?? true;
	const { context: backupContext, folder } = await ensureProjectBackupFolder(
		db,
		provider,
		context,
		options.folder ?? null
	);
	const summary = await deriveProjectBackupSummary(
		db,
		backupContext,
		folder,
		options.storeOptions
	);
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
		await updateLegacyCloudProjectFolderSyncState(db, {
			projectId: backupContext.projectId,
			connectionId: backupContext.connectionId,
			lastFullySyncedAt: options.now?.() ?? new Date().toISOString(),
		});
		result.uiState = 'synced';
		return result;
	}

	result.uiState =
		result.quarantines.length > 0 ? 'conflict requires resolution' : 'sync pending';
	return result;
}

export async function listProjectArchiveFiles(
	db: DbExecutor,
	projectId: string,
	options: SyncManagerOptions & { includeDrafts?: boolean } = {}
): Promise<ProjectArchiveFile[]> {
	const root = await loadProjectStoreRoot(db, projectId);
	const files = await listProjectArchiveFilePaths(root, options);
	return Promise.all(files.map(async file => ({
		path: file.path,
		storePath: file.storePath,
		content: await readTextFile(file.storePath, options.storeOptions),
	})));
}

export async function listProjectArchiveFilePaths(
	projectRoot: string,
	options: Pick<SyncManagerOptions, 'storeOptions'> & { includeDrafts?: boolean } = {}
): Promise<ProjectArchiveFilePath[]> {
	const files: ProjectArchiveFilePath[] = [];
	await collectProjectArchiveFilePaths(
		projectRoot,
		'',
		files,
		options.storeOptions ?? {},
		options.includeDrafts ?? false
	);
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function updateLegacyCloudProjectFolderSyncState(
	db: Kysely<Database>,
	input: { projectId: string; connectionId: string; lastFullySyncedAt: string }
): Promise<void> {
	try {
		await updateCloudProjectFolderSyncState(db, input);
	} catch (error) {
		if (error instanceof Error && /Cloud project folder .* was not found/.test(error.message)) {
			return;
		}
		throw error;
	}
}

export async function backupProjectEntity(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	reference: SyncEntityReference,
	options: ProjectBackupOptions = {}
): Promise<ProjectBackupResult> {
	const { context: backupContext } = await ensureProjectBackupFolder(
		db,
		provider,
		context,
		options.folder ?? null
	);
	const result: ProjectBackupResult = {
		...baseResult('sync pending', reference.entityType, reference.entityId),
		projectId: backupContext.projectId,
		manifestUploaded: false,
		entityResults: [],
		skippedItems: [],
	};
	const local = await loadLocalEntity(db, reference, options.storeOptions);
	if (local.projectId !== backupContext.projectId) {
		throw new Error(
			`${reference.entityType} ${reference.entityId} does not belong to this project.`
		);
	}
	const item = await deriveEntityBackupItem(db, backupContext, reference, options.storeOptions);
	if (isBlockingBackupItem(item)) {
		result.uiState =
			item.status === 'uncommitted-local-changes'
				? 'uncommitted local changes'
				: 'saved locally';
		result.skippedItems = [item];
		return result;
	}

	const entityResult = await publishEntity(db, provider, backupContext, reference, options);
	mergeOperationResult(result, entityResult);
	result.entityResults.push(entityResult);
	if (entityResult.uiState !== 'synced' || hasOperationFailure(result)) {
		result.uiState =
			result.quarantines.length > 0 ? 'conflict requires resolution' : 'sync pending';
		return result;
	}

	const manifestResult = await publishProjectManifest(db, provider, backupContext);
	mergeOperationResult(result, manifestResult);
	result.manifestUploaded = manifestResult.uiState === 'synced';
	result.uiState =
		result.manifestUploaded && !hasOperationFailure(result) ? 'synced' : 'sync pending';
	return result;
}

export function backupEligibleProjectEntities(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	options: ProjectBackupOptions = {}
): Promise<ProjectBackupResult> {
	return backupProject(db, provider, context, { ...options, strict: false });
}

async function ensureProjectBackupFolder(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	folder: CloudProjectFolderRecord | null
): Promise<{ context: SyncProjectContext; folder: CloudProjectFolderRecord | null }> {
	try {
		await provider.listFiles(context.cloudFolderId, { recursive: false });
		return { context, folder };
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

	const updatedFolder = await upsertCloudProjectFolder(db, {
		projectId: context.projectId,
		connectionId: context.connectionId,
		cloudFolderId: parentFolderId,
		cloudFolderPath: folderPath,
		syncCursor: folder?.syncCursor,
		lastFullySyncedAt: folder?.lastFullySyncedAt ?? null,
	});

	return {
		context: {
			...context,
			cloudFolderId: parentFolderId,
			cloudFolderPath: folderPath,
		},
		folder: updatedFolder,
	};
}

export async function deriveLocalSyncUiState(
	db: Kysely<Database>,
	context: SyncProjectContext,
	reference: SyncEntityReference
): Promise<SyncUiState> {
	const local = await loadLocalEntity(db, reference);
	if (local.dirty) return local.hasCommittedHead ? 'uncommitted local changes' : 'saved locally';
	const metadata = await getSyncMetadata(db, context, reference);
	if (!local.hasCommittedHead) return 'saved locally';
	if (!metadata) return 'committed locally';
	return headsEqual(local.head, lastSyncedHead(metadata)) ? 'synced' : 'sync pending';
}

export class OpenObjectSyncPoller {
	uiState: SyncUiState = 'saved locally';
	connectionState: OpenObjectPollerConnectionState = 'idle';
	nextDelayMs: number;
	lastResult: SyncOperationResult | null = null;
	private readonly poll: () => Promise<SyncOperationResult>;
	private readonly baseIntervalMs: number;
	private readonly maxIntervalMs: number;
	private readonly setTimer: typeof globalThis.setTimeout;
	private readonly clearTimer: typeof globalThis.clearTimeout;
	private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
	private stopped = true;

	constructor(options: OpenObjectSyncPollerOptions) {
		this.poll = options.poll;
		this.baseIntervalMs = options.baseIntervalMs ?? 30_000;
		this.maxIntervalMs = options.maxIntervalMs ?? 60_000;
		this.nextDelayMs = this.baseIntervalMs;
		this.setTimer = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
		this.clearTimer = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
	}

	start(): void {
		if (!this.stopped) return;
		this.stopped = false;
		this.schedule(0);
	}

	stop(): void {
		this.stopped = true;
		this.connectionState = 'idle';
		if (this.timer) this.clearTimer(this.timer);
		this.timer = null;
	}

	resumeAfterReconnect(): void {
		if (this.connectionState !== 'reconnect-required') return;
		this.connectionState = 'idle';
		this.stopped = false;
		this.nextDelayMs = this.baseIntervalMs;
		this.schedule(0);
	}

	focus(): Promise<SyncOperationResult | null> {
		return this.pollNow();
	}

	online(): Promise<SyncOperationResult | null> {
		return this.pollNow();
	}

	async pollNow(): Promise<SyncOperationResult | null> {
		if (this.stopped || this.connectionState === 'reconnect-required') return null;
		if (this.timer) this.clearTimer(this.timer);
		this.timer = null;
		this.connectionState = 'polling';
		try {
			const result = await this.poll();
			this.lastResult = result;
			this.uiState = result.uiState;
			if (result.providerError === 'reauthorization-required') {
				this.connectionState = 'reconnect-required';
				this.stopped = true;
				return result;
			}
			if (result.providerError && isBackoffProviderError(result.providerError)) {
				this.connectionState = 'backing-off';
				this.nextDelayMs = Math.min(this.nextDelayMs * 2, this.maxIntervalMs);
				this.schedule(this.nextDelayMs);
				return result;
			}
			this.connectionState = 'idle';
			this.nextDelayMs = this.baseIntervalMs;
			this.schedule(this.baseIntervalMs);
			return result;
		} catch (error) {
			if (isCloudProviderError(error, 'reauthorization-required')) {
				this.connectionState = 'reconnect-required';
				this.stopped = true;
				return null;
			}
			if (isCloudProviderError(error) && isBackoffProviderError(error.code)) {
				this.connectionState = 'backing-off';
				this.nextDelayMs = Math.min(this.nextDelayMs * 2, this.maxIntervalMs);
				this.schedule(this.nextDelayMs);
				return null;
			}
			throw error;
		}
	}

	private schedule(delayMs: number): void {
		if (this.stopped || this.connectionState === 'reconnect-required') return;
		if (this.timer) this.clearTimer(this.timer);
		this.timer = this.setTimer(() => {
			void this.pollNow();
		}, delayMs);
	}
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
				write = await provider.createFile(context.cloudFolderId, localFile.path, localFile.content);
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

		for (const remoteFile of [...remoteFiles.values()].filter(file => file.path.startsWith('tombstones/'))) {
			if (localFiles.some(file => file.path === remoteFile.path)) continue;
			const validation = await stageAndValidateProjectFiles(
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
			const pulledLocalFile = await writePulledMirrorFile(projectRoot, remoteFile, storeOptions);
			await deleteStoreFileIfExists(joinStorePath(projectRoot, parsed.value.cloud_path), storeOptions);
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
			) continue;
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
				const validation = await stageAndValidateProjectFiles(
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

			const validation = await stageAndValidateProjectFiles(
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
				) continue;
				const validation = await stageAndValidateProjectFiles(
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
				result.downloadedPaths.push(remoteFile.path);
			}

		if (pulledFiles.length > 0) {
			await rebuildIndexFromStore(db, storeOptions);
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
			const copyId = await createConflictCopy(
				db,
				await loadLocalEntity(db, reference, options.storeOptions),
				options
			);
			result.conflictCopyId ??= copyId;
		}

		const derivedTeiFiles = await regenerateDerivedTeiFiles(projectRoot, storeOptions);
		for (const localFile of derivedTeiFiles) {
			const remoteFile = remoteFiles.get(localFile.path) ?? null;
			const conflictingPrimary = conflictingRemotePrimaries.get(localFile.path);
			const remoteContent = conflictingPrimary
				? await deriveTeiFromCanonicalPrimary(
						conflictingPrimary.path,
						conflictingPrimary.content,
						context.projectId
					)
				: localFile.content;
			const remoteFingerprint = await fingerprintText(remoteContent, remoteFile?.metadata.modifiedAt ?? '');
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
				? await provider.updateFile(remoteFile.metadata.id, remoteContent, remoteFile.metadata.revision)
				: await provider.createFile(context.cloudFolderId, localFile.path, remoteContent);
			result.uploadedPaths.push(localFile.path);
			await upsertFileFingerprint(db, context, localFile, write, remoteFingerprint, now);
		}

		await writeProjectManifestFile(db, context.projectId, {}, storeOptions);
		const manifestFile = (await listLocalProjectMirrorFiles(db, context.projectId, storeOptions)).find(
			file => file.path === 'project.json'
		);
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
					: await provider.createFile(context.cloudFolderId, manifestFile.path, manifestFile.content);
				result.uploadedPaths.push(manifestFile.path);
				await upsertFileFingerprint(db, context, manifestFile, write, manifestFile.fingerprint, now);
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

async function loadProjectStoreRoot(db: DbExecutor, projectId: string): Promise<string> {
	const project = await db
		.selectFrom('projects')
		.select('storage_slug')
		.where('id', '=', projectId)
		.executeTakeFirst();
	if (!project?.storage_slug) throw new Error(`Project ${projectId} was not found.`);
	return projectFolder(project.storage_slug);
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

async function collectProjectArchiveFilePaths(
	storePath: string,
	relativePath: string,
	files: ProjectArchiveFilePath[],
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
			await collectProjectArchiveFilePaths(
				childStorePath,
				childRelativePath,
				files,
				storeOptions,
				includeDrafts
			);
			continue;
		}
		if (!shouldMirrorProjectFile(childRelativePath, includeDrafts)) continue;
		files.push({ path: childRelativePath, storePath: childStorePath });
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
): Promise<LocalMirrorFile[]> {
	const files: LocalMirrorFile[] = [];
	await collectLocalMirrorFiles(projectRoot, '', files, storeOptions, false);
	const derived: LocalMirrorFile[] = [];
	for (const primary of files) {
		const transcriptionMatch = /^transcriptions\/([^/]+)\.json$/.exec(primary.path);
		const collationMatch = /^collations\/([^/]+)\.json$/.exec(primary.path);
		if (!transcriptionMatch && !collationMatch) continue;
		const path = primary.path.replace(/\.json$/, '.tei.xml');
		const content = await deriveTeiFromCanonicalPrimary(primary.path, primary.content);
		const storePath = joinStorePath(projectRoot, path);
		await writeTextFileAtomic(storePath, content, storeOptions);
		derived.push({
			path,
			storePath,
			content,
			fingerprint: await fingerprintText(content, ''),
		});
	}
	return derived;
}

async function deriveTeiFromCanonicalPrimary(
	path: string,
	content: string,
	projectId?: string
): Promise<string> {
	const format = canonicalFormatForProjectPath(path);
	if (!format) throw new Error(`No canonical format is registered for ${path}.`);
	const parsed = await readCanonicalDocument<ProjectTranscriptionPayload | CollationPayload>(
		format,
		content,
		{ projectPath: path, projectId }
	);
	if (!parsed.ok) throw new Error(`Could not derive TEI from ${path}: ${parsed.quarantine.message}`);
	return path.startsWith('transcriptions/')
		? transcriptionDocumentToTei(parsed.payload as ProjectTranscriptionPayload)
		: collationDocumentToTei((parsed.payload as CollationPayload).document);
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

function shouldMirrorProjectFile(path: string, includeDrafts = false): boolean {
	const normalized = normalizeSlashes(path);
	if (!normalized || normalized.includes('.tmp-')) return false;
	if (normalized.endsWith('.working.json')) return includeDrafts;
	return normalized.endsWith('.json') || normalized.endsWith('.tei.xml');
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

function isMissingStoreEntryError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}

async function ensureHistoryFile(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	local: LocalEntityState,
	historyPath: string,
	result: SyncOperationResult,
	storeOptions: StoreOperationOptions = {}
): Promise<CloudFileMetadata | CloudWriteResult> {
	const existing = await findRemoteMetadata(provider, context, historyPath);
	if (existing) {
		const parsed = await parseHistoryCloudFile(await provider.downloadFile(existing.id));
		result.downloadedPaths.push(historyPath);
		if (!parsed.ok)
			throw new SyncQuarantineError(quarantineFor(historyPath, parsed.quarantine));
		if (
			parsed.value.checkpoint_id !== local.head.revisionId ||
			parsed.value.content_hash !== local.head.contentHash
		) {
			throw new SyncQuarantineError({
				path: historyPath,
				code: 'hash_mismatch',
				message: 'Remote history file does not match the committed local checkpoint.',
				expected: local.head,
				actual: {
					revisionId: parsed.value.checkpoint_id,
					contentHash: parsed.value.content_hash,
				},
			});
		}
		return existing;
	}

	const content =
		local.entityType === 'project-transcription'
			? await serializeCloudFile(
					await serializeProjectTranscriptionHistoryCloudFile(
						db,
						local.entityId,
						local.head.revisionId,
						storeOptions
					)
				)
			: await serializeCloudFile(
					await serializeCollationHistoryCloudFile(
						db,
						local.entityId,
						local.head.revisionId,
						storeOptions
					)
				);
	const write = await provider.createFile(context.cloudFolderId, historyPath, content);
	result.uploadedPaths.push(historyPath);
	return write;
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

async function putCloudFile(
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	path: string,
	content: string
): Promise<CloudWriteResult> {
	const existing = await findRemoteMetadata(provider, context, path);
	return existing
		? provider.updateFile(existing.id, content, existing.revision)
		: provider.createFile(context.cloudFolderId, path, content);
}

async function downloadRemoteEntity(
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	reference: SyncEntityReference,
	metadata: CloudFileMetadata,
	result: SyncOperationResult
): Promise<RemoteEntityState | null> {
	const primaryPath = primaryPathFor(reference.entityType, reference.entityId);
	const primaryContent = await provider.downloadFile(metadata.id);
	result.downloadedPaths.push(primaryPath);
	const primaryParse =
		reference.entityType === 'project-transcription'
			? await parseProjectTranscriptionCloudFile(primaryContent)
			: await parseCollationCloudFile(primaryContent);
	if (!primaryParse.ok) {
		result.quarantines.push(quarantineFor(primaryPath, primaryParse.quarantine));
		result.uiState = 'conflict requires resolution';
		return null;
	}

	const primary = primaryParse.value;
	const historyPath = historyPathFor(
		reference.entityType,
		reference.entityId,
		primary.current_revision.id
	);
	const historyMetadata = await findRemoteMetadata(provider, context, historyPath);
	if (!historyMetadata) {
		result.quarantines.push({
			path: historyPath,
			code: 'invalid_shape',
			message: 'Remote primary file points to a missing history checkpoint.',
		});
		result.uiState = 'conflict requires resolution';
		return null;
	}

	const historyContent = await provider.downloadFile(historyMetadata.id);
	result.downloadedPaths.push(historyPath);
	const historyParse = await parseHistoryCloudFile(historyContent);
	if (!historyParse.ok) {
		result.quarantines.push(quarantineFor(historyPath, historyParse.quarantine));
		result.uiState = 'conflict requires resolution';
		return null;
	}

	const validation =
		reference.entityType === 'project-transcription'
			? validateProjectTranscriptionHeadMatchesCheckpoint(
					primary as ProjectTranscriptionCloudFile,
					historyParse.value
				)
			: validateCollationHeadMatchesCheckpoint(
					primary as CollationCloudFile,
					historyParse.value
				);
	if (!validation.ok) {
		result.quarantines.push(quarantineFor(primaryPath, validation.quarantine));
		result.uiState = 'conflict requires resolution';
		return null;
	}

	return {
		metadata,
		primary,
		historyMetadata,
		history: historyParse.value,
		head: {
			revisionId: primary.current_revision.id,
			contentHash: primary.current_revision.content_hash,
		},
	};
}

async function applyRemoteEntity(
	db: Kysely<Database>,
	local: LocalEntityState,
	remote: RemoteEntityState
): Promise<void> {
	await db.transaction().execute(async trx => {
		if (local.entityType === 'project-transcription') {
			await applyProjectTranscriptionPrimary(
				trx,
				local.projectId,
				remote.primary as ProjectTranscriptionCloudFile
			);
			await insertRemoteCheckpoint(trx, remote.history);
			return;
		}
		await applyCollationPrimary(trx, remote.primary as CollationCloudFile);
		await insertRemoteCheckpoint(trx, remote.history);
	});
}

async function insertRemoteCheckpoint(db: DbExecutor, history: HistoryCloudFile): Promise<void> {
	const parentId = history.parent_checkpoint_id
		? await existingCheckpointId(
				db,
				history.entity_type,
				history.entity_id,
				history.parent_checkpoint_id
			)
		: null;
	if (history.entity_type === 'project-transcription') {
		await db
			.insertInto('transcription_checkpoints')
			.values({
				id: history.checkpoint_id,
				transcription_id: history.payload_transcription_id,
				parent_checkpoint_id: parentId,
				format: history.format,
				content_hash: history.content_hash,
				is_committed: 1,
				commit_message: history.commit_message,
				author_name: history.author_name,
				created_at: history.created_at,
			})
			.onConflict(oc => oc.column('id').doNothing())
			.execute();
		return;
	}
	await db
		.insertInto('collation_checkpoints')
		.values({
			id: history.checkpoint_id,
			collation_id: history.entity_id,
			parent_checkpoint_id: parentId,
			content_hash: history.content_hash,
			is_committed: 1,
			commit_message: history.commit_message,
			author_name: history.author_name,
			created_at: history.created_at,
		})
		.onConflict(oc => oc.column('id').doNothing())
		.execute();
}

async function applyProjectTranscriptionPrimary(
	db: DbExecutor,
	projectId: string,
	file: ProjectTranscriptionCloudFile
): Promise<void> {
	const now = file.updated_at;
	await db
		.insertInto('transcriptions')
		.values({
			id: file.id,
			project_id: projectId,
			origin_type: file.origin.source_type,
			origin_project_id: file.origin.source_project_id,
			origin_transcription_id: file.origin.source_transcription_id,
			origin_revision_id: file.origin.source_revision_id ?? '',
			origin_content_hash: file.origin.source_content_hash ?? '',
			current_revision_id: file.current_revision.id,
			current_content_hash: file.current_revision.content_hash,
			title: file.title,
			siglum: file.siglum,
			description: file.description,
			content_json: canonicalJson(file.content_json),
			format: file.format,
			created_at: file.created_at,
			updated_at: file.updated_at,
			owner: file.owner,
			is_public: file.is_public ? 1 : 0,
			tags: canonicalJson(file.tags),
			transcriber: file.transcriber,
			repository: file.repository,
			settlement: file.settlement,
			language: file.language,
		})
		.onConflict(oc =>
			oc.column('id').doUpdateSet({
				project_id: projectId,
				origin_type: file.origin.source_type,
				origin_project_id: file.origin.source_project_id,
				origin_transcription_id: file.origin.source_transcription_id,
				origin_revision_id: file.origin.source_revision_id ?? '',
				origin_content_hash: file.origin.source_content_hash ?? '',
				current_revision_id: file.current_revision.id,
				current_content_hash: file.current_revision.content_hash,
				title: file.title,
				siglum: file.siglum,
				description: file.description,
				content_json: canonicalJson(file.content_json),
				format: file.format,
				updated_at: file.updated_at,
				owner: file.owner,
				is_public: file.is_public ? 1 : 0,
				tags: canonicalJson(file.tags),
				transcriber: file.transcriber,
				repository: file.repository,
				settlement: file.settlement,
				language: file.language,
			})
		)
		.execute();
	await db
		.insertInto('project_transcriptions')
		.values({
			id: file.project_transcription_id,
			project_id: projectId,
			transcription_id: file.id,
			canonical_transcription_id: file.canonical_transcription_id,
			added_at: file.created_at,
		})
		.onConflict(oc =>
			oc.column('id').doUpdateSet({
				project_id: projectId,
				transcription_id: file.id,
				canonical_transcription_id: file.canonical_transcription_id,
			})
		)
		.execute();

	await deleteProjectTranscriptionChildren(db, file.id);
	if (file.iiif_manifest_sources.length > 0) {
		await db
			.insertInto('iiif_manifest_sources')
			.values(
				file.iiif_manifest_sources.map(
					(row): Selectable<IiifManifestSources> => ({
						id: row.id,
						transcription_id: file.id,
						manifest_url: row.manifest_url,
						label: row.label,
						source_kind: row.source_kind,
						default_canvas_id: row.default_canvas_id,
						default_image_service_url: row.default_image_service_url,
						metadata_json: canonicalJson(row.metadata_json),
						created_at: now,
						updated_at: now,
					})
				)
			)
			.execute();
	}
	if (file.page_canvas_links.length > 0) {
		await db
			.insertInto('transcription_page_canvas_links')
			.values(
				file.page_canvas_links.map(
					(row): Selectable<TranscriptionPageCanvasLinks> => ({
						id: row.id,
						transcription_id: file.id,
						page_id: row.page_id,
						page_name_snapshot: row.page_name_snapshot,
						page_order: row.page_order,
						manifest_source_id: row.manifest_source_id,
						manifest_url_snapshot: row.manifest_url_snapshot,
						canvas_id: row.canvas_id,
						canvas_order: row.canvas_order,
						canvas_label: row.canvas_label,
						image_service_url: row.image_service_url,
						thumbnail_url: row.thumbnail_url,
						link_role: row.link_role,
						created_at: now,
						updated_at: now,
					})
				)
			)
			.execute();
	}
	if (file.canvas_annotations.length > 0) {
		await db
			.insertInto('iiif_canvas_annotations')
			.values(
				file.canvas_annotations.map(
					(row): Selectable<IiifCanvasAnnotations> => ({
						id: row.id,
						transcription_id: file.id,
						manifest_source_id: row.manifest_source_id,
						canvas_id: row.canvas_id,
						page_id: row.page_id,
						annotation_id: row.annotation_id,
						annotation_kind: row.annotation_kind,
						body_json: canonicalJson(row.body_json),
						target_json: canonicalJson(row.target_json),
						anchor_json: canonicalJson(row.anchor_json),
						motivation: row.motivation,
						created_by: row.created_by,
						created_at: now,
						updated_at: now,
					})
				)
			)
			.execute();
	}
}

async function applyCollationPrimary(db: DbExecutor, file: CollationCloudFile): Promise<void> {
	const projection = collationCloudFileToImportInput(file);
	await db
		.insertInto('collations')
		.values({
			id: file.id,
			project_id: file.project_id,
			current_revision_id: file.current_revision.id,
			current_content_hash: file.current_revision.content_hash,
			title: file.title,
			verse_identifier: file.verse_identifier,
			status: file.status,
			group_path: file.group_path,
			notes: file.notes,
			sort_key: file.sort_key,
			created_at: file.created_at,
			updated_at: file.updated_at,
		})
		.onConflict(oc =>
			oc.column('id').doUpdateSet({
				project_id: file.project_id,
				current_revision_id: file.current_revision.id,
				current_content_hash: file.current_revision.content_hash,
				title: file.title,
				verse_identifier: file.verse_identifier,
				status: file.status,
				group_path: file.group_path,
				notes: file.notes,
				sort_key: file.sort_key,
				updated_at: file.updated_at,
			})
		)
		.execute();
	await deleteCollationChildren(db, file.id);
	if (projection.artifacts.length > 0) {
		await db
			.insertInto('collation_artifacts')
			.values(
				projection.artifacts.map(row => ({
					id: row.id,
					collation_id: file.id,
					artifact_type: row.artifact_type,
					payload: canonicalJson(row.payload),
					created_at: file.updated_at,
				}))
			)
			.execute();
	}
	if (projection.witnesses.length > 0) {
		const projectTranscriptionByTranscription = await loadProjectTranscriptionIds(
			db,
			file.project_id,
			projection.witnesses.map(row => row.transcription_id)
		);
		await db
			.insertInto('collation_witnesses')
			.values(
				projection.witnesses.map(row => ({
					...row,
					project_transcription_id: row.transcription_id
						? (projectTranscriptionByTranscription.get(row.transcription_id) ?? null)
						: null,
					collation_id: file.id,
				}))
			)
			.execute();
	}
	if (projection.tokens.length > 0) {
		await db
			.insertInto('collation_tokens')
			.values(projection.tokens.map(row => ({ ...row, collation_id: file.id })))
			.execute();
	}
	if (projection.variation_units.length > 0) {
		await db
			.insertInto('collation_variation_units')
			.values(projection.variation_units.map(row => ({ ...row, collation_id: file.id })))
			.execute();
	}
	if (projection.readings.length > 0) {
		await db
			.insertInto('collation_readings')
			.values(
				projection.readings.map(row => ({
					...row,
					is_lacuna: row.is_lacuna ? 1 : 0,
					is_omission: row.is_omission ? 1 : 0,
				}))
			)
			.execute();
	}
	if (projection.reading_witnesses.length > 0) {
		await db
			.insertInto('collation_reading_witnesses')
			.values(
				projection.reading_witnesses.map(row => ({
					id: `${row.reading_id}:${row.witness_id}`,
					reading_id: row.reading_id,
					witness_id: row.witness_id,
				}))
			)
			.execute();
	}
}

async function deleteProjectTranscriptionChildren(
	db: DbExecutor,
	transcriptionId: string
): Promise<void> {
	await db
		.deleteFrom('iiif_canvas_annotations')
		.where('transcription_id', '=', transcriptionId)
		.execute();
	await db
		.deleteFrom('transcription_page_canvas_links')
		.where('transcription_id', '=', transcriptionId)
		.execute();
	await db
		.deleteFrom('iiif_manifest_sources')
		.where('transcription_id', '=', transcriptionId)
		.execute();
}

async function deleteCollationChildren(db: DbExecutor, collationId: string): Promise<void> {
	const variationUnits = await db
		.selectFrom('collation_variation_units')
		.select('id')
		.where('collation_id', '=', collationId)
		.execute();
	const variationUnitIds = variationUnits.map(row => requireId(row.id, 'variation unit'));
	if (variationUnitIds.length > 0) {
		const readings = await db
			.selectFrom('collation_readings')
			.select('id')
			.where('variation_unit_id', 'in', variationUnitIds)
			.execute();
		const readingIds = readings.map(row => requireId(row.id, 'reading'));
		if (readingIds.length > 0) {
			await db
				.deleteFrom('collation_reading_witnesses')
				.where('reading_id', 'in', readingIds)
				.execute();
		}
		await db
			.deleteFrom('collation_readings')
			.where('variation_unit_id', 'in', variationUnitIds)
			.execute();
		await db
			.deleteFrom('collation_variation_units')
			.where('id', 'in', variationUnitIds)
			.execute();
	}
	await db.deleteFrom('collation_tokens').where('collation_id', '=', collationId).execute();
	await db.deleteFrom('collation_witnesses').where('collation_id', '=', collationId).execute();
	await db.deleteFrom('collation_artifacts').where('collation_id', '=', collationId).execute();
}

async function existingCheckpointId(
	db: DbExecutor,
	entityType: SyncEntityType,
	entityId: string,
	checkpointId: string
): Promise<string | null> {
	const row =
		entityType === 'project-transcription'
			? await db
					.selectFrom('project_transcriptions')
					.innerJoin(
						'transcription_checkpoints',
						'transcription_checkpoints.transcription_id',
						'project_transcriptions.transcription_id'
					)
					.select('transcription_checkpoints.id as id')
					.where('project_transcriptions.id', '=', entityId)
					.where('transcription_checkpoints.id', '=', checkpointId)
					.executeTakeFirst()
			: await db
					.selectFrom('collation_checkpoints')
					.select('id')
					.where('collation_id', '=', entityId)
					.where('id', '=', checkpointId)
					.executeTakeFirst();
	return row?.id ?? null;
}

async function preserveLocalDraft(
	db: Kysely<Database>,
	local: LocalEntityState,
	options: SyncManagerOptions
): Promise<{ checkpointId: string } | null> {
	if (local.entityType === 'project-transcription') {
		return preserveProjectTranscriptionDraftCheckpoint(db, {
			projectTranscriptionId: local.entityId,
			authorName: options.authorName,
			createdAt: options.now?.(),
		});
	}
	return preserveCollationDraftCheckpoint(db, {
		collationId: local.entityId,
		authorName: options.authorName,
		createdAt: options.now?.(),
	});
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
		return copy.projectTranscriptionId;
	}
	const copy = await createCollationConflictCopy(db, {
		collationId: local.entityId,
		actorName: options.authorName,
		now: options.now?.(),
	});
	return copy.collationId;
}

async function listProjectTranscriptionReferences(
	db: DbExecutor,
	projectId: string
): Promise<SyncEntityReference[]> {
	const rows = await db
		.selectFrom('project_transcriptions')
		.select('id')
		.where('project_id', '=', projectId)
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		entityType: 'project-transcription',
		entityId: requireId(row.id, 'project transcription'),
	}));
}

async function listProjectCollationReferences(
	db: DbExecutor,
	projectId: string
): Promise<SyncEntityReference[]> {
	const rows = await db
		.selectFrom('collations')
		.select('id')
		.where('project_id', '=', projectId)
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		entityType: 'collation',
		entityId: requireId(row.id, 'collation'),
	}));
}

async function deriveEntityBackupItem(
	db: Kysely<Database>,
	context: SyncProjectContext,
	reference: SyncEntityReference,
	storeOptions: StoreOperationOptions = {}
): Promise<BackupItemState> {
	const local = await loadLocalEntity(db, reference, storeOptions);
	const backupState = await deriveEntityCloudBackupState(
		db,
		context,
		reference,
		local.hasCommittedHead ? local.head : null,
		local.dirty
	);
	return backupStateToItem(reference, local, backupState);
}

function backupStateToItem(
	reference: SyncEntityReference,
	local: LocalEntityState,
	backupState: EntityCloudBackupState | undefined
): BackupItemState {
	const base = {
		itemType: reference.entityType,
		itemId: reference.entityId,
		path: local.primaryPath,
		localHead: local.hasCommittedHead ? local.head : undefined,
	};
	if (!backupState) return { ...base, status: 'unknown' };
	if (backupState.status === 'never-backed-up') {
		return {
			...base,
			status: local.hasCommittedHead ? 'committed-pending-backup' : 'never-committed',
			reason: local.hasCommittedHead ? undefined : 'No committed version exists.',
		};
	}
	return {
		...base,
		status: backupState.status as ProjectBackupItemStatus,
		reason:
			backupState.status === 'uncommitted-local-changes'
				? 'Commit local changes before backup.'
				: undefined,
	};
}

async function compareProjectManifestHeads(
	db: Kysely<Database>,
	context: SyncProjectContext,
	remoteManifest: ProjectCloudFile,
	storeOptions: StoreOperationOptions = {}
): Promise<ProjectRemoteManifestState> {
	if (remoteManifest.id !== context.projectId) return 'diverged';
	const references = [
		...(await listProjectTranscriptionReferences(db, context.projectId)),
		...(await listProjectCollationReferences(db, context.projectId)),
	];
	let sawRemoteOnlyChange = false;
	let sawLocalOnlyChange = false;
	for (const reference of references) {
		const local = await loadLocalEntity(db, reference, storeOptions);
		const remoteHead = remoteManifestHead(remoteManifest, reference);
		const metadata = await getSyncMetadata(db, context, reference);
		if (!remoteHead) {
			if (local.hasCommittedHead) sawLocalOnlyChange = true;
			continue;
		}
		if (!local.hasCommittedHead) {
			sawRemoteOnlyChange = true;
			continue;
		}
		if (headsEqual(local.head, remoteHead)) continue;
		const lastSynced =
			(await getLastSyncedEntityHead(db, context, reference)) ??
			(metadata ? lastSyncedHead(metadata) : null);
		if (!lastSynced) return 'diverged';
		if (headsEqual(local.head, lastSynced) && !headsEqual(remoteHead, lastSynced)) {
			sawRemoteOnlyChange = true;
			continue;
		}
		if (!headsEqual(local.head, lastSynced) && headsEqual(remoteHead, lastSynced)) {
			sawLocalOnlyChange = true;
			continue;
		}
		return 'diverged';
	}
	if (sawRemoteOnlyChange && sawLocalOnlyChange) return 'diverged';
	if (sawRemoteOnlyChange) return 'remote-update-available';
	return 'up-to-date';
}

function remoteManifestHead(
	manifest: ProjectCloudFile,
	reference: SyncEntityReference
): SyncEntityHead | null {
	const head =
		reference.entityType === 'project-transcription'
			? manifest.transcriptions.find(
					item => item.project_transcription_id === reference.entityId
				)?.current_revision
			: manifest.collations.find(item => item.collation_id === reference.entityId)
					?.current_revision;
	return head ? { revisionId: head.id, contentHash: head.content_hash } : null;
}

function isBlockingBackupItem(item: BackupItemState): boolean {
	return item.status === 'uncommitted-local-changes' || item.status === 'never-committed';
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

async function loadLocalEntity(
	db: Kysely<Database>,
	reference: SyncEntityReference,
	storeOptions: StoreOperationOptions = {}
): Promise<LocalEntityState> {
	if (reference.entityType === 'project-transcription') {
		const row = await db
			.selectFrom('project_transcriptions')
			.innerJoin(
				'transcriptions',
				'transcriptions.id',
				'project_transcriptions.transcription_id'
			)
			.select([
				'project_transcriptions.project_id as project_id',
				'transcriptions.current_revision_id as current_revision_id',
				'transcriptions.current_content_hash as current_content_hash',
			])
			.where('project_transcriptions.id', '=', reference.entityId)
			.executeTakeFirst();
		if (!row) throw new Error(`Project transcription ${reference.entityId} was not found.`);
		const head = {
			revisionId: row.current_revision_id,
			contentHash: row.current_content_hash,
		};
		return {
			entityType: reference.entityType,
			entityId: reference.entityId,
			projectId: row.project_id,
			primaryPath: primaryPathFor(reference.entityType, reference.entityId),
			head,
			dirty: await isTranscriptionDirty(db, reference.entityId),
			hasCommittedHead: hasHead(head),
		};
	}

	const row = await db
		.selectFrom('collations')
		.select(['project_id', 'current_revision_id', 'current_content_hash'])
		.where('id', '=', reference.entityId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${reference.entityId} was not found.`);
	if (!row.project_id)
		throw new Error(`Collation ${reference.entityId} is not attached to a project.`);
	const head = {
		revisionId: row.current_revision_id,
		contentHash: row.current_content_hash,
	};
	return {
		entityType: reference.entityType,
		entityId: reference.entityId,
		projectId: row.project_id,
		primaryPath: primaryPathFor(reference.entityType, reference.entityId),
		head,
		dirty: (
			await getCollationVersionStatusWithWorkingFile(
				db,
				reference.entityId,
				{},
				{
					...storeOptions,
					allowIndexFallback: false,
				}
			)
		).dirtyToCheckpoint,
		hasCommittedHead: hasHead(head),
	};
}

async function getSyncMetadata(
	db: DbExecutor,
	context: SyncProjectContext,
	reference: SyncEntityReference
): Promise<CloudSyncMetadataRecord | null> {
	const row = await db
		.selectFrom('cloud_sync_metadata')
		.selectAll()
		.where('connection_id', '=', context.connectionId)
		.where('scope_type', '=', PROJECT_SCOPE_TYPE)
		.where('scope_id', '=', context.projectId)
		.where('entity_type', '=', reference.entityType)
		.where('entity_id', '=', reference.entityId)
		.executeTakeFirst();
	return row ? mapCloudSyncMetadata(row) : null;
}

async function getLastSyncedEntityHead(
	db: DbExecutor,
	context: SyncProjectContext,
	reference: SyncEntityReference
): Promise<SyncEntityHead | null> {
	const row = await db
		.selectFrom('sync_file_fingerprints')
		.select(['revision_id', 'entity_content_hash'])
		.where('target_id', '=', context.connectionId)
		.where('project_id', '=', context.projectId)
		.where('entity_type', '=', reference.entityType)
		.where('entity_id', '=', reference.entityId)
		.where('revision_id', '!=', '')
		.orderBy('synced_at', 'desc')
		.executeTakeFirst();
	return row?.revision_id && row.entity_content_hash
		? { revisionId: row.revision_id, contentHash: row.entity_content_hash }
		: null;
}

async function upsertSyncMetadata(
	db: DbExecutor,
	context: SyncProjectContext,
	local: LocalEntityState,
	write: CloudWriteResult,
	now: string
): Promise<void> {
	await db
		.insertInto('cloud_sync_metadata')
		.values({
			connection_id: context.connectionId,
			scope_type: PROJECT_SCOPE_TYPE,
			scope_id: context.projectId,
			entity_type: local.entityType,
			entity_id: local.entityId,
			cloud_file_id: write.id,
			cloud_file_revision: write.revision,
			cloud_path: local.primaryPath,
			last_synced_revision: local.head.revisionId,
			last_synced_hash: local.head.contentHash,
			last_synced_at: now,
		})
		.onConflict(oc =>
			oc
				.columns(['connection_id', 'scope_type', 'scope_id', 'entity_type', 'entity_id'])
				.doUpdateSet({
					cloud_file_id: write.id,
					cloud_file_revision: write.revision,
					cloud_path: local.primaryPath,
					last_synced_revision: local.head.revisionId,
					last_synced_hash: local.head.contentHash,
					last_synced_at: now,
				})
		)
		.execute();
}

async function upsertSyncMetadataFromRemote(
	db: DbExecutor,
	context: SyncProjectContext,
	local: LocalEntityState,
	remote: RemoteEntityState,
	now: string
): Promise<void> {
	await upsertSyncMetadata(
		db,
		context,
		{ ...local, head: remote.head },
		{
			id: remote.metadata.id,
			path: remote.metadata.path,
			revision: remote.metadata.revision,
			modifiedAt: remote.metadata.modifiedAt,
			size: remote.metadata.size,
		},
		now
	);
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

async function findRemoteMetadata(
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	path: string
): Promise<CloudFileMetadata | null> {
	const entries = await listRemoteMetadata(provider, context);
	return entries.find(entry => relativeEntryPath(entry.path, context) === path) ?? null;
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

function primaryPathFor(entityType: SyncEntityType, entityId: string): string {
	const paths = projectRelativeCloudPaths();
	return entityType === 'project-transcription'
		? paths.transcriptions(entityId)
		: paths.collations(entityId);
}

function historyPathFor(
	entityType: SyncEntityType,
	entityId: string,
	checkpointId: string
): string {
	const paths = projectRelativeCloudPaths();
	return entityType === 'project-transcription'
		? paths.transcriptionHistory(entityId, checkpointId)
		: paths.collationHistory(entityId, checkpointId);
}

function classifyWithoutMetadata(
	local: LocalEntityState,
	remoteHead: SyncEntityHead
): ReturnType<typeof classifyCommittedHeadSync> {
	if (!local.hasCommittedHead) return 'remote_only_change';
	return headsEqual(local.head, remoteHead) ? 'in_sync' : 'local_remote_conflict';
}

function mapCloudSyncMetadata(row: Selectable<CloudSyncMetadata>): CloudSyncMetadataRecord {
	return {
		connectionId: row.connection_id,
		scopeType: row.scope_type,
		scopeId: row.scope_id,
		entityType: row.entity_type,
		entityId: row.entity_id,
		cloudFileId: row.cloud_file_id,
		cloudFileRevision: row.cloud_file_revision,
		cloudPath: row.cloud_path,
		lastSyncedRevision: row.last_synced_revision,
		lastSyncedHash: row.last_synced_hash,
		lastSyncedAt: row.last_synced_at,
	};
}

function lastSyncedHead(metadata: CloudSyncMetadataRecord): SyncEntityHead {
	return {
		revisionId: metadata.lastSyncedRevision,
		contentHash: metadata.lastSyncedHash,
	};
}

function headsEqual(left: SyncEntityHead, right: SyncEntityHead): boolean {
	return left.revisionId === right.revisionId && left.contentHash === right.contentHash;
}

function hasHead(head: SyncEntityHead): boolean {
	return Boolean(head.revisionId && head.contentHash);
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

function normalizeSlashes(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} id.`);
	return value;
}

function isBackoffProviderError(code: CloudProviderErrorCode): boolean {
	return code === 'rate-limited' || code === 'provider-unavailable' || code === 'unknown';
}

class SyncQuarantineError extends Error {
	constructor(readonly quarantine: SyncQuarantine) {
		super(quarantine.message);
		this.name = 'SyncQuarantineError';
	}
}

export function syncProviderErrorResult(
	error: CloudProviderError,
	entity?: SyncEntityReference
): SyncOperationResult {
	return {
		...baseResult('sync pending', entity?.entityType, entity?.entityId),
		providerError: error.code,
		providerMessage: error.message,
	};
}
