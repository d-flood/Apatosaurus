import { nanoid } from 'nanoid';
import type { Kysely, Selectable, Transaction } from 'kysely';

import type { CloudCredentials } from '$lib/client/sync/providers/provider';
import type { CloudConnections, Database } from '../types.generated';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface CloudConnectionRecord {
	id: string;
	providerId: string;
	providerAccountId: string;
	accountEmail: string;
	scopes: string[];
	credentials: CloudCredentials;
	connectedAt: string;
	updatedAt: string;
}

export interface UpsertCloudConnectionInput {
	id?: string;
	providerId: string;
	providerAccountId?: string;
	accountEmail: string;
	scopes?: string[];
	credentials: CloudCredentials;
	connectedAt?: string;
	updatedAt?: string;
}

export interface UpdateCloudCredentialsInput {
	connectionId: string;
	credentials: CloudCredentials;
	updatedAt?: string;
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
	connectionId: string,
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
	providerAccountId = '',
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
	input: UpsertCloudConnectionInput,
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
			access_token: input.credentials.accessToken,
			refresh_token: input.credentials.refreshToken ?? null,
			expires_at: input.credentials.expiresAt ?? null,
			connected_at: connectedAt,
			updated_at: updatedAt,
		})
		.onConflict((oc) =>
			oc.columns(['provider_id', 'provider_account_id']).doUpdateSet({
				account_email: input.accountEmail.trim(),
				scopes: serializeScopes(input.scopes),
				access_token: input.credentials.accessToken,
				refresh_token: input.credentials.refreshToken ?? null,
				expires_at: input.credentials.expiresAt ?? null,
				updated_at: updatedAt,
			}),
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

export async function updateCloudConnectionCredentials(
	db: DbExecutor,
	input: UpdateCloudCredentialsInput,
): Promise<CloudConnectionRecord> {
	await db
		.updateTable('cloud_connections')
		.set({
			access_token: input.credentials.accessToken,
			refresh_token: input.credentials.refreshToken ?? null,
			expires_at: input.credentials.expiresAt ?? null,
			updated_at: input.updatedAt ?? new Date().toISOString(),
		})
		.where('id', '=', input.connectionId)
		.executeTakeFirst();
	const row = await db
		.selectFrom('cloud_connections')
		.selectAll()
		.where('id', '=', input.connectionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Cloud connection ${input.connectionId} was not found.`);
	return mapCloudConnection(row);
}

export async function refreshCloudConnectionCredentials(
	db: DbExecutor,
	input: UpdateCloudCredentialsInput,
): Promise<CloudConnectionRecord> {
	const current = await db
		.selectFrom('cloud_connections')
		.select(['id', 'refresh_token'])
		.where('id', '=', input.connectionId)
		.executeTakeFirst();
	if (!current) throw new Error(`Cloud connection ${input.connectionId} was not found.`);

	await db
		.updateTable('cloud_connections')
		.set({
			access_token: input.credentials.accessToken,
			refresh_token: input.credentials.refreshToken ?? current.refresh_token,
			expires_at: input.credentials.expiresAt ?? null,
			updated_at: input.updatedAt ?? new Date().toISOString(),
		})
		.where('id', '=', input.connectionId)
		.executeTakeFirst();
	return (await getCloudConnection(db, input.connectionId)) as CloudConnectionRecord;
}

export async function disconnectCloudConnection(
	db: Kysely<Database>,
	connectionId: string,
): Promise<boolean> {
	return db.transaction().execute(async (trx) => {
		await trx.deleteFrom('cloud_project_folders').where('connection_id', '=', connectionId).execute();
		await trx.deleteFrom('cloud_sync_metadata').where('connection_id', '=', connectionId).execute();
		const result = await trx
			.deleteFrom('cloud_connections')
			.where('id', '=', connectionId)
			.executeTakeFirst();
		return Number(result.numDeletedRows) > 0;
	});
}

export async function wipeCloudConnections(db: Kysely<Database>): Promise<number> {
	return db.transaction().execute(async (trx) => {
		const rows = await trx.selectFrom('cloud_connections').select('id').execute();
		const ids = rows.map((row) => requireId(row.id, 'cloud connection'));
		if (ids.length === 0) return 0;
		await trx.deleteFrom('cloud_project_folders').where('connection_id', 'in', ids).execute();
		await trx.deleteFrom('cloud_sync_metadata').where('connection_id', 'in', ids).execute();
		const result = await trx.deleteFrom('cloud_connections').where('id', 'in', ids).executeTakeFirst();
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
		credentials: {
			accessToken: row.access_token,
			refreshToken: row.refresh_token ?? undefined,
			expiresAt: row.expires_at ?? undefined,
		},
		connectedAt: row.connected_at,
		updatedAt: row.updated_at,
	};
}

function serializeScopes(scopes: string[] = []): string {
	return JSON.stringify([...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort());
}

function parseScopes(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [];
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
