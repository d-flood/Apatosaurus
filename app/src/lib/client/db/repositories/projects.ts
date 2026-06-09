import { nanoid } from 'nanoid';
import type { Kysely, Selectable, Transaction } from 'kysely';

import type { Database, Projects, ProjectTranscriptions, Transcriptions } from '../types.generated';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface ProjectOption {
	id: string;
	name: string;
	description: string;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectRecord extends ProjectOption {
	charter: string;
	collationSettings: unknown;
	ownerId: number | null;
}

export interface ProjectTranscriptionOption {
	id: string;
	siglum: string;
	displayLabel: string;
	title: string;
	description: string;
}

export interface CreateProjectInput {
	id?: string;
	name: string;
	description?: string;
	charter?: string;
	collationSettings?: unknown;
	ownerId?: number | null;
	createdAt?: string;
	updatedAt?: string;
}

export interface UpdateProjectMetadataInput {
	projectId: string;
	name?: string;
	description?: string;
	charter?: string;
	collationSettings?: unknown;
	updatedAt?: string;
}

export async function listProjects(db: DbExecutor): Promise<ProjectOption[]> {
	const rows = await db
		.selectFrom('projects')
		.select(['id', 'name', 'description', 'created_at', 'updated_at'])
		.orderBy('updated_at', 'desc')
		.execute();
	return rows.map(mapProjectOption);
}

export async function getProject(db: DbExecutor, projectId: string): Promise<ProjectRecord | null> {
	const row = await db.selectFrom('projects').selectAll().where('id', '=', projectId).executeTakeFirst();
	return row ? mapProject(row) : null;
}

export async function createProject(db: DbExecutor, input: CreateProjectInput): Promise<string> {
	const now = new Date().toISOString();
	const id = input.id ?? createId();
	await db
		.insertInto('projects')
		.values({
			id,
			name: input.name.trim(),
			description: input.description?.trim() ?? '',
			charter: input.charter ?? '',
			collation_settings: JSON.stringify(input.collationSettings ?? {}),
			owner_id: input.ownerId ?? null,
			created_at: input.createdAt ?? now,
			updated_at: input.updatedAt ?? input.createdAt ?? now,
		})
		.execute();
	return id;
}

export async function updateProjectMetadata(
	db: DbExecutor,
	input: UpdateProjectMetadataInput,
): Promise<void> {
	const updates: Partial<Selectable<Projects>> = {
		updated_at: input.updatedAt ?? new Date().toISOString(),
	};
	if (input.name !== undefined) updates.name = input.name.trim();
	if (input.description !== undefined) updates.description = input.description.trim();
	if (input.charter !== undefined) updates.charter = input.charter;
	if (input.collationSettings !== undefined) updates.collation_settings = JSON.stringify(input.collationSettings);

	const result = await db.updateTable('projects').set(updates).where('id', '=', input.projectId).executeTakeFirst();
	if (Number(result.numUpdatedRows) === 0) throw new Error(`Project ${input.projectId} was not found.`);
}

export async function listProjectTranscriptionOptions(
	db: DbExecutor,
): Promise<ProjectTranscriptionOption[]> {
	const rows = await db
		.selectFrom('transcriptions')
		.select(['id', 'siglum', 'title', 'description'])
		.where('scope_type', '=', 'global')
		.where('project_id', 'is', null)
		.orderBy('siglum')
		.execute();
	return rows
		.map((row) => ({
			id: requireId(row.id, 'transcription'),
			siglum: row.siglum,
			displayLabel: getPreferredTranscriptionLabel(row),
			title: row.title,
			description: row.description,
		}))
		.sort((a, b) => a.displayLabel.localeCompare(b.displayLabel, undefined, { sensitivity: 'base', numeric: true }));
}

export async function loadTranscriptionContent(
	db: DbExecutor,
	transcriptionId: string,
): Promise<string | null> {
	const row = await db
		.selectFrom('transcriptions')
		.select('content_json')
		.where('id', '=', transcriptionId)
		.where('scope_type', '=', 'global')
		.where('project_id', 'is', null)
		.executeTakeFirst();
	return row?.content_json ?? null;
}

export async function getProjectTranscriptionIds(
	db: DbExecutor,
	projectId: string,
): Promise<string[]> {
	const rows = await db
		.selectFrom('project_transcriptions')
		.select('transcription_id')
		.where('project_id', '=', projectId)
		.orderBy('added_at')
		.execute();
	return rows.map((row) => requireId(row.transcription_id, 'project transcription'));
}

export async function syncProjectTranscriptionIds(
	db: Kysely<Database>,
	projectId: string,
	nextIds: string[],
): Promise<void> {
	const uniqueIds = [...new Set(nextIds.map((id) => id.trim()).filter(Boolean))];
	const now = new Date().toISOString();
	await db.transaction().execute(async (trx) => {
		if (uniqueIds.length === 0) {
			await trx.deleteFrom('project_transcriptions').where('project_id', '=', projectId).execute();
		} else {
			await trx
				.deleteFrom('project_transcriptions')
				.where('project_id', '=', projectId)
				.where('transcription_id', 'not in', uniqueIds)
				.execute();
		}

		const rows: Selectable<ProjectTranscriptions>[] = uniqueIds.map((transcriptionId) => ({
			id: createId(),
			project_id: projectId,
			transcription_id: transcriptionId,
			canonical_transcription_id: null,
			added_at: now,
			added_by_id: null,
		}));
		if (rows.length > 0) {
			await trx
				.insertInto('project_transcriptions')
				.values(rows)
				.onConflict((oc) => oc.columns(['project_id', 'transcription_id']).doNothing())
				.execute();
		}
		await trx.updateTable('projects').set({ updated_at: now }).where('id', '=', projectId).execute();
	});
}

function mapProjectOption(row: Pick<Selectable<Projects>, 'id' | 'name' | 'description' | 'created_at' | 'updated_at'>): ProjectOption {
	return {
		id: requireId(row.id, 'project'),
		name: row.name,
		description: row.description,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapProject(row: Selectable<Projects>): ProjectRecord {
	return {
		...mapProjectOption(row),
		charter: row.charter,
		collationSettings: parseJson(row.collation_settings),
		ownerId: row.owner_id,
	};
}

function getPreferredTranscriptionLabel(row: Pick<Selectable<Transcriptions>, 'id' | 'siglum'>): string {
	return row.siglum.trim() || requireId(row.id, 'transcription');
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} id`);
	return value;
}

function createId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : nanoid();
}
