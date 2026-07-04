import type { Kysely, Selectable, Transaction } from 'kysely';

import type {
	CloudSyncMetadata,
	Database,
	IiifCanvasAnnotations,
	IiifManifestSources,
	TranscriptionPageCanvasLinks,
} from '$lib/client/db/types.generated';
import {
	createCommittedCollationCheckpoint,
	createCommittedTranscriptionCheckpoint,
	isCollationDirty,
	isTranscriptionDirty,
	type CollationCheckpoint,
	type CommitCollationInput,
	type CommitTranscriptionInput,
	type TranscriptionCheckpoint,
} from '$lib/client/db/repositories/revisions';
import { canonicalJson } from './canonical-json';
import {
	applyCollationTombstone,
	applyProjectTranscriptionTombstone,
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
	serializeTombstoneCloudFile,
	validateCollationHeadMatchesCheckpoint,
	validateProjectTranscriptionHeadMatchesCheckpoint,
	type CloudFileQuarantine,
	type CollationCloudFile,
	type HistoryCloudFile,
	type ProjectCloudFile,
	type ProjectTranscriptionCloudFile,
	type TombstoneCloudFile,
} from './cloud-files';
import {
	CloudProviderError,
	isCloudProviderError,
	type CloudFileMetadata,
	type CloudProviderErrorCode,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './providers/provider';

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

const PROJECT_SCOPE_TYPE = 'project';

export async function commitProjectTranscriptionForSync(
	db: Kysely<Database>,
	input: CommitTranscriptionInput
): Promise<SyncOperationResult & { checkpoint: TranscriptionCheckpoint }> {
	const checkpoint = await createCommittedTranscriptionCheckpoint(db, input);
	return {
		...baseResult('sync pending', 'project-transcription', input.projectTranscriptionId),
		checkpoint,
		checkpointId: checkpoint.id,
		localHead: { revisionId: checkpoint.id, contentHash: checkpoint.contentHash },
	};
}

export async function commitCollationForSync(
	db: Kysely<Database>,
	input: CommitCollationInput
): Promise<SyncOperationResult & { checkpoint: CollationCheckpoint }> {
	const checkpoint = await createCommittedCollationCheckpoint(db, input);
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
		const local = await loadLocalEntity(db, reference);
		result.localHead = local.head;
		if (!local.hasCommittedHead) {
			result.uiState = local.dirty ? 'uncommitted local changes' : 'saved locally';
			return result;
		}

		const historyPath = historyPathFor(local.entityType, local.entityId, local.head.revisionId);
		await ensureHistoryFile(db, provider, context, local, historyPath, result);
		historyUploaded = true;

		const primaryContent = await serializePrimaryFile(db, local);
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
	const local = await loadLocalEntity(db, reference);
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

export async function syncProjectTombstones(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext
): Promise<SyncOperationResult> {
	const result = baseResult('synced');
	const tombstones = await db
		.selectFrom('sync_tombstones')
		.selectAll()
		.where('project_id', '=', context.projectId)
		.execute();

	for (const tombstone of tombstones) {
		const tombstoneId = requireId(tombstone.id, 'tombstone');
		const file = await serializeTombstoneCloudFile(db, tombstoneId);
		const path = projectRelativeCloudPaths().tombstones(tombstoneId);
		await putCloudFile(provider, context, path, await serializeCloudFile(file));
		result.uploadedPaths.push(path);

		const primary = await findRemoteMetadata(provider, context, tombstone.cloud_path);
		if (primary) {
			await provider.deleteFile(
				primary.id,
				provider.capabilities.supportsExpectedRevisionDelete ? primary.revision : undefined
			);
			result.deletedPaths.push(tombstone.cloud_path);
		}
	}

	const remoteTombstones = await listRemoteMetadata(provider, context, 'tombstones/');
	for (const metadata of remoteTombstones.filter(entry => entry.path.endsWith('.json'))) {
		const content = await provider.downloadFile(metadata.id);
		result.downloadedPaths.push(relativeEntryPath(metadata.path, context));
		const parsed = await parseTombstoneCloudFile(content);
		if (!parsed.ok) {
			result.quarantines.push(quarantineFor(metadata.path, parsed.quarantine));
			continue;
		}
		await applyRemoteTombstone(db, parsed.value);
	}

	if (result.quarantines.length > 0) result.uiState = 'conflict requires resolution';
	return result;
}

export async function deriveProjectBackupSummary(
	db: Kysely<Database>,
	context: SyncProjectContext,
	folder: CloudProjectFolderRecord | null = null
): Promise<ProjectBackupSummary> {
	const [transcriptionReferences, collationReferences, tombstones] = await Promise.all([
		listProjectTranscriptionReferences(db, context.projectId),
		listProjectCollationReferences(db, context.projectId),
		db
			.selectFrom('sync_tombstones')
			.select(['id'])
			.where('project_id', '=', context.projectId)
			.orderBy('id', 'asc')
			.execute(),
	]);
	const [transcriptions, collations] = await Promise.all([
		Promise.all(
			transcriptionReferences.map(reference => deriveEntityBackupItem(db, context, reference))
		),
		Promise.all(
			collationReferences.map(reference => deriveEntityBackupItem(db, context, reference))
		),
	]);
	const tombstoneItems = tombstones.map(row => {
		const id = requireId(row.id, 'tombstone');
		return {
			itemType: 'tombstone' as const,
			itemId: id,
			path: projectRelativeCloudPaths().tombstones(id),
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
	context: SyncProjectContext
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
		result.state = await compareProjectManifestHeads(db, context, parsed.value);
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
	const summary = await deriveProjectBackupSummary(db, backupContext, folder);
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

	for (const item of [...summary.transcriptions, ...summary.collations]) {
		if (isBlockingBackupItem(item)) {
			result.skippedItems.push(item);
			continue;
		}
		const entityResult = await publishEntity(
			db,
			provider,
			backupContext,
			{ entityType: item.itemType as SyncEntityType, entityId: item.itemId },
			options
		);
		mergeOperationResult(result, entityResult);
		result.entityResults.push(entityResult);
	}

	const tombstoneResult = await syncProjectTombstones(db, provider, backupContext);
	mergeOperationResult(result, tombstoneResult);
	result.entityResults.push(tombstoneResult);

	if (!hasOperationFailure(result)) {
		const manifestResult = await publishProjectManifest(db, provider, backupContext);
		mergeOperationResult(result, manifestResult);
		result.manifestUploaded = manifestResult.uiState === 'synced';
	}

	if (
		result.manifestUploaded &&
		!hasOperationFailure(result) &&
		result.skippedItems.length === 0
	) {
		await updateCloudProjectFolderSyncState(db, {
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
	const local = await loadLocalEntity(db, reference);
	if (local.projectId !== backupContext.projectId) {
		throw new Error(`${reference.entityType} ${reference.entityId} does not belong to this project.`);
	}
	const item = await deriveEntityBackupItem(db, backupContext, reference);
	if (isBlockingBackupItem(item)) {
		result.uiState = item.status === 'uncommitted-local-changes' ? 'uncommitted local changes' : 'saved locally';
		result.skippedItems = [item];
		return result;
	}

	const entityResult = await publishEntity(db, provider, backupContext, reference, options);
	mergeOperationResult(result, entityResult);
	result.entityResults.push(entityResult);
	if (entityResult.uiState !== 'synced' || hasOperationFailure(result)) {
		result.uiState = result.quarantines.length > 0 ? 'conflict requires resolution' : 'sync pending';
		return result;
	}

	const manifestResult = await publishProjectManifest(db, provider, backupContext);
	mergeOperationResult(result, manifestResult);
	result.manifestUploaded = manifestResult.uiState === 'synced';
	result.uiState = result.manifestUploaded && !hasOperationFailure(result) ? 'synced' : 'sync pending';
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
	const segments = folderPath.split('/').map(segment => segment.trim()).filter(Boolean);
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

async function ensureHistoryFile(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext,
	local: LocalEntityState,
	historyPath: string,
	result: SyncOperationResult
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
						local.head.revisionId
					)
				)
			: await serializeCloudFile(
					await serializeCollationHistoryCloudFile(
						db,
						local.entityId,
						local.head.revisionId
					)
				);
	const write = await provider.createFile(context.cloudFolderId, historyPath, content);
	result.uploadedPaths.push(historyPath);
	return write;
}

async function serializePrimaryFile(
	db: Kysely<Database>,
	local: LocalEntityState
): Promise<string> {
	if (local.entityType === 'project-transcription') {
		return serializeCloudFile(await serializeProjectTranscriptionCloudFile(db, local.entityId));
	}
	return serializeCloudFile(await serializeCollationCloudFile(db, local.entityId));
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
				payload: canonicalJson(history.payload),
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
			payload: canonicalJson(history.payload),
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
			added_by_id: null,
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
	if (file.artifacts.length > 0) {
		await db
			.insertInto('collation_artifacts')
			.values(
				file.artifacts.map(row => ({
					id: row.id,
					collation_id: file.id,
					artifact_type: row.artifact_type,
					payload: canonicalJson(row.payload),
					created_at: file.updated_at,
				}))
			)
			.execute();
	}
	if (file.witnesses.length > 0) {
		await db
			.insertInto('collation_witnesses')
			.values(file.witnesses.map(row => ({ ...row, collation_id: file.id })))
			.execute();
	}
	if (file.tokens.length > 0) {
		await db
			.insertInto('collation_tokens')
			.values(file.tokens.map(row => ({ ...row, collation_id: file.id })))
			.execute();
	}
	if (file.variation_units.length > 0) {
		await db
			.insertInto('collation_variation_units')
			.values(file.variation_units.map(row => ({ ...row, collation_id: file.id })))
			.execute();
	}
	if (file.readings.length > 0) {
		await db
			.insertInto('collation_readings')
			.values(
				file.readings.map(row => ({
					...row,
					is_lacuna: row.is_lacuna ? 1 : 0,
					is_omission: row.is_omission ? 1 : 0,
				}))
			)
			.execute();
	}
	if (file.reading_witnesses.length > 0) {
		await db
			.insertInto('collation_reading_witnesses')
			.values(
				file.reading_witnesses.map(row => ({
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

async function applyRemoteTombstone(db: Kysely<Database>, file: TombstoneCloudFile): Promise<void> {
	if (file.entity_type === 'project-transcription') {
		await applyProjectTranscriptionTombstone(db, {
			id: file.id,
			project_id: file.project_id,
			entity_type: file.entity_type,
			entity_id: file.entity_id,
			cloud_path: file.cloud_path,
			deletion_revision_id: file.deletion_revision_id,
			deleted_by: file.deleted_by,
			deleted_at: file.deleted_at,
		});
		return;
	}
	if (file.entity_type === 'collation') {
		await applyCollationTombstone(db, {
			id: file.id,
			project_id: file.project_id,
			entity_type: file.entity_type,
			entity_id: file.entity_id,
			cloud_path: file.cloud_path,
			deletion_revision_id: file.deletion_revision_id,
			deleted_by: file.deleted_by,
			deleted_at: file.deleted_at,
		});
	}
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
	reference: SyncEntityReference
): Promise<BackupItemState> {
	const local = await loadLocalEntity(db, reference);
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
	remoteManifest: ProjectCloudFile
): Promise<ProjectRemoteManifestState> {
	if (remoteManifest.id !== context.projectId) return 'diverged';
	const references = [
		...(await listProjectTranscriptionReferences(db, context.projectId)),
		...(await listProjectCollationReferences(db, context.projectId)),
	];
	let sawRemoteOnlyChange = false;
	let sawLocalOnlyChange = false;
	for (const reference of references) {
		const local = await loadLocalEntity(db, reference);
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
		if (!metadata) return 'diverged';
		const lastSynced = lastSyncedHead(metadata);
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
	if (source.providerError) target.providerError = source.providerError;
	if (source.providerMessage) target.providerMessage = source.providerMessage;
}

function hasOperationFailure(result: SyncOperationResult): boolean {
	return Boolean(result.providerError) || result.quarantines.length > 0;
}

async function loadLocalEntity(
	db: Kysely<Database>,
	reference: SyncEntityReference
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
		dirty: await isCollationDirty(db, reference.entityId),
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
