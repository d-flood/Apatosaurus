import { nanoid } from 'nanoid';
import type { Kysely, Selectable, Transaction } from 'kysely';

import type { CloudConnections, CloudProjectFolders, Database } from '../types.generated';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface CloudConnectionRecord {
	id: string;
	providerId: string;
	providerAccountId: string;
	accountEmail: string;
	scopes: string[];
	connectedAt: string;
	updatedAt: string;
}

export interface UpsertCloudConnectionInput {
	id?: string;
	providerId: string;
	providerAccountId?: string;
	accountEmail: string;
	scopes?: string[];
	connectedAt?: string;
	updatedAt?: string;
}

export interface CloudProjectFolderRecord {
	projectId: string;
	connectionId: string;
	cloudFolderId: string;
	cloudFolderPath: string;
	syncCursor: string;
	lastFullySyncedAt: string | null;
}

export interface UpsertCloudProjectFolderInput {
	projectId: string;
	connectionId: string;
	cloudFolderId: string;
	cloudFolderPath: string;
	syncCursor?: string;
	lastFullySyncedAt?: string | null;
}

export interface UpdateCloudProjectFolderSyncStateInput {
	projectId: string;
	connectionId: string;
	syncCursor?: string;
	lastFullySyncedAt?: string | null;
}

export async function listCloudConnections(db: DbExecutor): Promise<CloudConnectionRecord[]> {
	const rows = await db
		.selectFrom('cloud_connections')
		.selectAll()
		.orderBy('updated_at', 'desc')
		.execute();
	return rows.map(mapCloudConnection);
}

export async function getCloudConnection(
	db: DbExecutor,
	connectionId: string
): Promise<CloudConnectionRecord | null> {
	const row = await db
		.selectFrom('cloud_connections')
		.selectAll()
		.where('id', '=', connectionId)
		.executeTakeFirst();
	return row ? mapCloudConnection(row) : null;
}

export async function getCloudConnectionByProviderAccount(
	db: DbExecutor,
	providerId: string,
	providerAccountId = ''
): Promise<CloudConnectionRecord | null> {
	const row = await db
		.selectFrom('cloud_connections')
		.selectAll()
		.where('provider_id', '=', providerId)
		.where('provider_account_id', '=', providerAccountId)
		.executeTakeFirst();
	return row ? mapCloudConnection(row) : null;
}

export async function upsertCloudConnection(
	db: DbExecutor,
	input: UpsertCloudConnectionInput
): Promise<CloudConnectionRecord> {
	const now = new Date().toISOString();
	const providerAccountId = input.providerAccountId ?? '';
	const connectedAt = input.connectedAt ?? now;
	const updatedAt = input.updatedAt ?? connectedAt;
	const id = input.id ?? createId();

	await db
		.insertInto('cloud_connections')
		.values({
			id,
			provider_id: input.providerId,
			provider_account_id: providerAccountId,
			account_email: input.accountEmail.trim(),
			scopes: serializeScopes(input.scopes),
			connected_at: connectedAt,
			updated_at: updatedAt,
		})
		.onConflict(oc =>
			oc.columns(['provider_id', 'provider_account_id']).doUpdateSet({
				account_email: input.accountEmail.trim(),
				scopes: serializeScopes(input.scopes),
				updated_at: updatedAt,
			})
		)
		.execute();

	const row = await db
		.selectFrom('cloud_connections')
		.selectAll()
		.where('provider_id', '=', input.providerId)
		.where('provider_account_id', '=', providerAccountId)
		.executeTakeFirstOrThrow();
	return mapCloudConnection(row);
}

export async function listCloudProjectFolders(
	db: DbExecutor,
	projectId: string
): Promise<CloudProjectFolderRecord[]> {
	const rows = await db
		.selectFrom('cloud_project_folders')
		.selectAll()
		.where('project_id', '=', projectId)
		.orderBy('cloud_folder_path', 'asc')
		.execute();
	return rows.map(mapCloudProjectFolder);
}

export async function getCloudProjectFolder(
	db: DbExecutor,
	projectId: string,
	connectionId: string
): Promise<CloudProjectFolderRecord | null> {
	const row = await db
		.selectFrom('cloud_project_folders')
		.selectAll()
		.where('project_id', '=', projectId)
		.where('connection_id', '=', connectionId)
		.executeTakeFirst();
	return row ? mapCloudProjectFolder(row) : null;
}

export async function upsertCloudProjectFolder(
	db: DbExecutor,
	input: UpsertCloudProjectFolderInput
): Promise<CloudProjectFolderRecord> {
	await db
		.insertInto('cloud_project_folders')
		.values({
			project_id: input.projectId,
			connection_id: input.connectionId,
			cloud_folder_id: input.cloudFolderId,
			cloud_folder_path: input.cloudFolderPath,
			sync_cursor: input.syncCursor ?? '',
			last_fully_synced_at: input.lastFullySyncedAt ?? null,
		})
		.onConflict(oc =>
			oc.column('project_id').doUpdateSet({
				connection_id: input.connectionId,
				cloud_folder_id: input.cloudFolderId,
				cloud_folder_path: input.cloudFolderPath,
				sync_cursor: input.syncCursor ?? '',
				last_fully_synced_at: input.lastFullySyncedAt ?? null,
			})
		)
		.execute();
	return (await getCloudProjectFolder(db, input.projectId, input.connectionId)) as CloudProjectFolderRecord;
}

export async function updateCloudProjectFolderSyncState(
	db: DbExecutor,
	input: UpdateCloudProjectFolderSyncStateInput
): Promise<CloudProjectFolderRecord> {
	await db
		.updateTable('cloud_project_folders')
		.set({
			...(input.syncCursor !== undefined ? { sync_cursor: input.syncCursor } : {}),
			...(input.lastFullySyncedAt !== undefined
				? { last_fully_synced_at: input.lastFullySyncedAt }
				: {}),
		})
		.where('project_id', '=', input.projectId)
		.where('connection_id', '=', input.connectionId)
		.executeTakeFirst();
	const folder = await getCloudProjectFolder(db, input.projectId, input.connectionId);
	if (!folder) {
		throw new Error(
			`Cloud project folder for project ${input.projectId} and connection ${input.connectionId} was not found.`
		);
	}
	return folder;
}

export async function unlinkCloudProjectFolder(
	db: DbExecutor,
	projectId: string,
	connectionId: string
): Promise<boolean> {
	const result = await db
		.deleteFrom('cloud_project_folders')
		.where('project_id', '=', projectId)
		.where('connection_id', '=', connectionId)
		.executeTakeFirst();
	return Number(result.numDeletedRows) > 0;
}

export async function disconnectCloudConnection(
	db: Kysely<Database>,
	connectionId: string
): Promise<boolean> {
	return db.transaction().execute(async trx => {
		await trx
			.deleteFrom('cloud_project_folders')
			.where('connection_id', '=', connectionId)
			.execute();
		await trx
			.deleteFrom('cloud_sync_metadata')
			.where('connection_id', '=', connectionId)
			.execute();
		const result = await trx
			.deleteFrom('cloud_connections')
			.where('id', '=', connectionId)
			.executeTakeFirst();
		return Number(result.numDeletedRows) > 0;
	});
}

export async function wipeCloudConnections(db: Kysely<Database>): Promise<number> {
	return db.transaction().execute(async trx => {
		const rows = await trx.selectFrom('cloud_connections').select('id').execute();
		const ids = rows.map(row => requireId(row.id, 'cloud connection'));
		if (ids.length === 0) return 0;
		await trx.deleteFrom('cloud_project_folders').where('connection_id', 'in', ids).execute();
		await trx.deleteFrom('cloud_sync_metadata').where('connection_id', 'in', ids).execute();
		const result = await trx
			.deleteFrom('cloud_connections')
			.where('id', 'in', ids)
			.executeTakeFirst();
		return Number(result.numDeletedRows);
	});
}

function mapCloudConnection(row: Selectable<CloudConnections>): CloudConnectionRecord {
	return {
		id: requireId(row.id, 'cloud connection'),
		providerId: row.provider_id,
		providerAccountId: row.provider_account_id,
		accountEmail: row.account_email,
		scopes: parseScopes(row.scopes),
		connectedAt: row.connected_at,
		updatedAt: row.updated_at,
	};
}

function mapCloudProjectFolder(row: Selectable<CloudProjectFolders>): CloudProjectFolderRecord {
	return {
		projectId: requireId(row.project_id, 'cloud project folder project'),
		connectionId: row.connection_id,
		cloudFolderId: row.cloud_folder_id,
		cloudFolderPath: row.cloud_folder_path,
		syncCursor: row.sync_cursor,
		lastFullySyncedAt: row.last_fully_synced_at,
	};
}

function serializeScopes(scopes: string[] = []): string {
	return JSON.stringify([...new Set(scopes.map(scope => scope.trim()).filter(Boolean))].sort());
}

function parseScopes(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((scope): scope is string => typeof scope === 'string')
			: [];
	} catch {
		return [];
	}
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} id.`);
	return value;
}

function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: nanoid();
}
