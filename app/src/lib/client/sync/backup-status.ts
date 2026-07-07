import type { Kysely, Selectable, Transaction } from 'kysely';

import type {
	CloudSyncMetadata,
	Database,
	SyncFileFingerprints,
} from '$lib/client/db/types.generated';
import { projectRelativeCloudPaths } from './cloud-paths';

type DbExecutor = Kysely<Database> | Transaction<Database>;

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

export type EntityCloudBackupStatus =
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

export function cloudPathForEntity(reference: SyncEntityReference): string {
	const paths = projectRelativeCloudPaths();
	return reference.entityType === 'project-transcription'
		? paths.transcriptions(reference.entityId)
		: paths.collations(reference.entityId);
}

async function getSyncMetadata(
	db: DbExecutor,
	context: SyncProjectContext,
	reference: SyncEntityReference
): Promise<CloudSyncMetadataRecord | null> {
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
	if (row) return mapSyncFileFingerprint(row);

	const legacyRow = await db
		.selectFrom('cloud_sync_metadata')
		.selectAll()
		.where('connection_id', '=', context.connectionId)
		.where('scope_type', '=', PROJECT_SCOPE_TYPE)
		.where('scope_id', '=', context.projectId)
		.where('entity_type', '=', reference.entityType)
		.where('entity_id', '=', reference.entityId)
		.executeTakeFirst();
	return legacyRow ? mapCloudSyncMetadata(legacyRow) : null;
}

function baseBackupState(
	context: SyncProjectContext,
	reference: SyncEntityReference,
	metadata: CloudSyncMetadataRecord | null,
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

function mapSyncFileFingerprint(
	row: Selectable<SyncFileFingerprints>
): CloudSyncMetadataRecord {
	return {
		connectionId: row.target_id,
		scopeType: PROJECT_SCOPE_TYPE,
		scopeId: row.project_id,
		entityType: row.entity_type,
		entityId: row.entity_id,
		cloudFileId: row.remote_file_id,
		cloudFileRevision: row.remote_revision,
		cloudPath: row.file_path,
		lastSyncedRevision: row.revision_id,
		lastSyncedHash: row.entity_content_hash,
		lastSyncedAt: row.synced_at,
	};
}

function lastSyncedHead(metadata: CloudSyncMetadataRecord): EntityVersionHead {
	return {
		revisionId: metadata.lastSyncedRevision,
		contentHash: metadata.lastSyncedHash,
	};
}

function headsEqual(left: EntityVersionHead, right: EntityVersionHead): boolean {
	return left.revisionId === right.revisionId && left.contentHash === right.contentHash;
}
