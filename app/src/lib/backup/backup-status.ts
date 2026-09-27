import type { Selectable } from 'kysely';

import type { SyncFileFingerprints } from '$lib/db/types.generated';
import { projectRelativePaths } from '$lib/storage/layout';
import type { DbExecutor } from '$lib/db/worker-kysely';

export type SyncEntityType = 'project-transcription' | 'collation';

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

export interface EntityVersionHead {
	revisionId: string;
	contentHash: string;
}

type EntityCloudBackupStatus =
	| 'not-configured'
	| 'never-backed-up'
	| 'backed-up'
	| 'committed-pending-backup'
	| 'remote-update-available'
	| 'uncommitted-local-changes'
	| 'unknown';

export interface EntityCloudBackupState {
	connectionId: string;
	projectId: string;
	entityType: SyncEntityType;
	entityId: string;
	status: EntityCloudBackupStatus;
	lastSyncedRevision: string | null;
	lastSyncedHash: string | null;
	lastSeenRemoteRevision: string | null;
	lastSeenRemoteHash: string | null;
	lastSyncedAt: string | null;
	cloudPath: string | null;
}

export interface EntityCloudBackupStatusOptions {
	lastSeenRemoteHead?: EntityVersionHead | null;
}

interface SyncedEntityRecord {
	cloudPath: string;
	lastSyncedRevision: string;
	lastSyncedHash: string;
	lastSyncedAt: string;
}

export async function deriveEntityCloudBackupState(
	db: DbExecutor,
	context: SyncProjectContext | null | undefined,
	reference: SyncEntityReference,
	currentCheckpoint: EntityVersionHead | null,
	dirtyToCheckpoint: boolean,
	options: EntityCloudBackupStatusOptions = {}
): Promise<EntityCloudBackupState | undefined> {
	if (!context) return undefined;

	const metadata = await getSyncMetadata(db, context, reference);
	const lastSeenRemoteHead = options.lastSeenRemoteHead ?? null;
	const base = baseBackupState(context, reference, metadata, lastSeenRemoteHead);

	if (dirtyToCheckpoint) return { ...base, status: 'uncommitted-local-changes' };
	if (!currentCheckpoint) return { ...base, status: 'never-backed-up' };
	if (!metadata) return { ...base, status: 'committed-pending-backup' };

	const lastSynced = lastSyncedHead(metadata);
	if (lastSeenRemoteHead && !headsEqual(lastSeenRemoteHead, currentCheckpoint)) {
		if (headsEqual(currentCheckpoint, lastSynced)) {
			return { ...base, status: 'remote-update-available' };
		}
		if (!headsEqual(lastSeenRemoteHead, lastSynced)) {
			return { ...base, status: 'unknown' };
		}
	}

	return headsEqual(currentCheckpoint, lastSynced)
		? { ...base, status: 'backed-up' }
		: { ...base, status: 'committed-pending-backup' };
}

function cloudPathForEntity(reference: SyncEntityReference): string {
	const paths = projectRelativePaths();
	return reference.entityType === 'project-transcription'
		? paths.transcriptions(reference.entityId)
		: paths.collations(reference.entityId);
}

async function getSyncMetadata(
	db: DbExecutor,
	context: SyncProjectContext,
	reference: SyncEntityReference
): Promise<SyncedEntityRecord | null> {
	const row = await db
		.selectFrom('sync_file_fingerprints')
		.selectAll()
		.where('target_id', '=', context.connectionId)
		.where('project_id', '=', context.projectId)
		.where('entity_type', '=', reference.entityType)
		.where('entity_id', '=', reference.entityId)
		.where('revision_id', '!=', '')
		.orderBy('synced_at', 'desc')
		.executeTakeFirst();
	return row ? mapSyncFileFingerprint(row) : null;
}

function baseBackupState(
	context: SyncProjectContext,
	reference: SyncEntityReference,
	metadata: SyncedEntityRecord | null,
	lastSeenRemoteHead: EntityVersionHead | null
): Omit<EntityCloudBackupState, 'status'> {
	return {
		connectionId: context.connectionId,
		projectId: context.projectId,
		entityType: reference.entityType,
		entityId: reference.entityId,
		lastSyncedRevision: metadata?.lastSyncedRevision ?? null,
		lastSyncedHash: metadata?.lastSyncedHash ?? null,
		lastSeenRemoteRevision: lastSeenRemoteHead?.revisionId ?? null,
		lastSeenRemoteHash: lastSeenRemoteHead?.contentHash ?? null,
		lastSyncedAt: metadata?.lastSyncedAt ?? null,
		cloudPath: metadata?.cloudPath ?? cloudPathForEntity(reference),
	};
}

function mapSyncFileFingerprint(row: Selectable<SyncFileFingerprints>): SyncedEntityRecord {
	return {
		cloudPath: row.file_path,
		lastSyncedRevision: row.revision_id,
		lastSyncedHash: row.entity_content_hash,
		lastSyncedAt: row.synced_at,
	};
}

function lastSyncedHead(metadata: SyncedEntityRecord): EntityVersionHead {
	return {
		revisionId: metadata.lastSyncedRevision,
		contentHash: metadata.lastSyncedHash,
	};
}

function headsEqual(left: EntityVersionHead, right: EntityVersionHead): boolean {
	return left.revisionId === right.revisionId && left.contentHash === right.contentHash;
}
