import { nanoid } from 'nanoid';
import type { Insertable, Kysely, Transaction } from 'kysely';

import type { Database, Projects } from '../types.generated';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export const DEFAULT_PROJECT_NAME = 'Default';

export async function ensureDefaultProject(db: DbExecutor): Promise<string> {
	const existing = await db
		.selectFrom('projects')
		.select(['id'])
		.where('name', '=', DEFAULT_PROJECT_NAME)
		.orderBy('created_at', 'asc')
		.executeTakeFirst();
	if (existing?.id) return existing.id;

	const now = new Date().toISOString();
	const id = createId();
	const row: Insertable<Projects> = {
		id,
		storage_slug: await generateUniqueProjectStorageSlug(db, DEFAULT_PROJECT_NAME),
		name: DEFAULT_PROJECT_NAME,
		description: '',
		charter: '',
		collation_settings: '{}',
		created_at: now,
		updated_at: now,
	};
	await db.insertInto('projects').values(row).execute();
	return id;
}

export async function resolveProjectStorageSlug(
	db: DbExecutor,
	name: string,
	storageSlug?: string | null
): Promise<string> {
	const provided = storageSlug?.trim();
	if (provided) return normalizeProjectStorageSlug(provided);
	return generateUniqueProjectStorageSlug(db, name);
}

export async function generateUniqueProjectStorageSlug(
	db: DbExecutor,
	name: string
): Promise<string> {
	const base = normalizeProjectStorageSlug(name);
	for (let attempt = 0; attempt < 20; attempt++) {
		const slug = `${base}-${createSlugSuffix()}`;
		const existing = await db
			.selectFrom('projects')
			.select('id')
			.where('storage_slug', '=', slug)
			.executeTakeFirst();
		if (!existing) return slug;
	}
	throw new Error(`Could not generate a unique storage slug for project ${name}.`);
}

export function normalizeProjectStorageSlug(value: string): string {
	const normalized = value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/g, '');
	return normalized || 'project';
}

function createSlugSuffix(): string {
	const raw =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID().replace(/-/g, '')
			: nanoid(12).replace(/[^a-zA-Z0-9]/g, '');
	return (raw || nanoid(12)).slice(0, 8).toLowerCase();
}

function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: nanoid();
}
