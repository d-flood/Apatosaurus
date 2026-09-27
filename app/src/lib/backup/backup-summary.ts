import type { Kysely } from 'kysely';
import type { Database } from '$lib/db/types.generated';
import { isTranscriptionDirty } from '$lib/db/repositories/revisions';
import { getCollationVersionStatusWithWorkingFile } from '$lib/db/repositories/collation-files';
import type { StoreOperationOptions } from '$lib/storage/opfs-store';
import type { SyncEntityHead } from './conflicts';
import {
	deriveEntityCloudBackupState,
	type EntityCloudBackupState,
	type SyncEntityReference,
	type SyncEntityType,
	type SyncProjectContext,
} from './backup-status';
import { projectRelativePaths } from '$lib/storage/layout';
import { requireId } from '$lib/db/repositories/id';
import type { DbExecutor } from '$lib/db/worker-kysely';

type ProjectBackupItemType = 'project-manifest' | SyncEntityType | 'tombstone';

type ProjectBackupItemStatus =
	| 'backed-up'
	| 'committed-pending-backup'
	| 'uncommitted-local-changes'
	| 'never-committed'
	| 'remote-update-available'
	| 'diverged'
	| 'unknown';

type ProjectRemoteManifestState =
	'not-checked' | 'up-to-date' | 'remote-update-available' | 'diverged' | 'unavailable';

export interface BackupItemState {
	itemType: ProjectBackupItemType;
	itemId: string;
	path: string;
	status: ProjectBackupItemStatus;
	localHead?: SyncEntityHead;
	remoteHead?: SyncEntityHead;
	reason?: string;
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
}

export async function deriveProjectBackupSummary(
	db: Kysely<Database>,
	context: SyncProjectContext,
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
			path: projectRelativePaths().tombstones(row.entity_type, row.entity_id),
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
			path: projectRelativePaths().project,
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
	};
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

function isBlockingBackupItem(item: BackupItemState): boolean {
	return item.status === 'uncommitted-local-changes' || item.status === 'never-committed';
}

export interface LocalEntityState {
	entityType: SyncEntityType;
	entityId: string;
	projectId: string;
	primaryPath: string;
	head: SyncEntityHead;
	dirty: boolean;
	hasCommittedHead: boolean;
}

export async function loadLocalEntity(
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

export function primaryPathFor(entityType: SyncEntityType, entityId: string): string {
	const paths = projectRelativePaths();
	return entityType === 'project-transcription'
		? paths.transcriptions(entityId)
		: paths.collations(entityId);
}

function hasHead(head: SyncEntityHead): boolean {
	return Boolean(head.revisionId && head.contentHash);
}
