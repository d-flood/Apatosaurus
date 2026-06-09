import { nanoid } from 'nanoid';
import type { Kysely, Selectable, Transaction } from 'kysely';

import type {
	Database,
	IiifCanvasAnnotations,
	IiifManifestSources,
	Projects,
	ProjectTranscriptions,
	TranscriptionPageCanvasLinks,
	TranscriptionVerseIndex,
	Transcriptions,
} from '../types.generated';

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
	projectId?: string | null,
): Promise<ProjectTranscriptionOption[]> {
	const linkedRows = projectId
		? await db
				.selectFrom('project_transcriptions')
				.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
				.select([
					'transcriptions.id as id',
					'transcriptions.siglum as siglum',
					'transcriptions.title as title',
					'transcriptions.description as description',
					'transcriptions.origin_transcription_id as origin_transcription_id',
					'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
				])
				.where('project_transcriptions.project_id', '=', projectId)
				.orderBy('project_transcriptions.added_at')
				.execute()
		: [];
	const linkedSourceIds = new Set(
		linkedRows.flatMap((row) => [row.canonical_transcription_id, row.origin_transcription_id].filter(isNonEmptyString)),
	);

	let globalQuery = db
		.selectFrom('transcriptions')
		.select(['id', 'siglum', 'title', 'description'])
		.where('scope_type', '=', 'global')
		.where('project_id', 'is', null);
	if (linkedSourceIds.size > 0) globalQuery = globalQuery.where('id', 'not in', [...linkedSourceIds]);
	const globalRows = await globalQuery.orderBy('siglum').execute();

	return [...linkedRows, ...globalRows]
		.map(mapProjectTranscriptionOption)
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
): Promise<string[]> {
	const uniqueIds = [...new Set(nextIds.map((id) => id.trim()).filter(Boolean))];
	const now = new Date().toISOString();
	return db.transaction().execute(async (trx) => {
		const currentRows = await trx
			.selectFrom('project_transcriptions')
			.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
			.select([
				'project_transcriptions.id as project_transcription_id',
				'project_transcriptions.transcription_id as transcription_id',
				'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
				'transcriptions.scope_type as scope_type',
				'transcriptions.project_id as transcription_project_id',
				'transcriptions.origin_transcription_id as origin_transcription_id',
			])
			.where('project_transcriptions.project_id', '=', projectId)
			.orderBy('project_transcriptions.added_at')
			.execute();

		const currentBySnapshotId = new Map<string, (typeof currentRows)[number]>();
		const currentBySourceId = new Map<string, (typeof currentRows)[number]>();
		for (const row of currentRows) {
			const snapshotId = requireId(row.transcription_id, 'project transcription snapshot');
			currentBySnapshotId.set(snapshotId, row);
			if (row.canonical_transcription_id) currentBySourceId.set(row.canonical_transcription_id, row);
			if (row.origin_transcription_id) currentBySourceId.set(row.origin_transcription_id, row);
		}

		const keptProjectTranscriptionIds = new Set<string>();
		const snapshotIds: string[] = [];
		const sourceIdsToClone: string[] = [];
		for (const requestedId of uniqueIds) {
			const current = currentBySnapshotId.get(requestedId) ?? currentBySourceId.get(requestedId);
			if (current) {
				keptProjectTranscriptionIds.add(requireId(current.project_transcription_id, 'project transcription'));
				snapshotIds.push(requireId(current.transcription_id, 'project transcription snapshot'));
				continue;
			}
			sourceIdsToClone.push(requestedId);
		}

		const removedRows = currentRows.filter(
			(row) => !keptProjectTranscriptionIds.has(requireId(row.project_transcription_id, 'project transcription')),
		);
		const removedProjectTranscriptionIds = removedRows.map((row) => requireId(row.project_transcription_id, 'project transcription'));
		const removedSnapshotIds = removedRows
			.filter((row) => row.scope_type === 'project_snapshot' && row.transcription_project_id === projectId)
			.map((row) => requireId(row.transcription_id, 'project transcription snapshot'));

		if (removedProjectTranscriptionIds.length > 0) {
			await trx
				.deleteFrom('project_transcriptions')
				.where('id', 'in', removedProjectTranscriptionIds)
				.execute();
		}
		if (removedSnapshotIds.length > 0) {
			await trx
				.deleteFrom('transcriptions')
				.where('id', 'in', removedSnapshotIds)
				.where('scope_type', '=', 'project_snapshot')
				.where('project_id', '=', projectId)
				.execute();
		}

		for (const sourceId of sourceIdsToClone) {
			const snapshot = await addProjectTranscriptionSnapshot(trx, projectId, sourceId, now);
			snapshotIds.push(snapshot.transcriptionId);
		}

		await trx.updateTable('projects').set({ updated_at: now }).where('id', '=', projectId).execute();
		return snapshotIds;
	});
}

async function addProjectTranscriptionSnapshot(
	db: DbExecutor,
	projectId: string,
	sourceId: string,
	now: string,
): Promise<{ transcriptionId: string; canonicalTranscriptionId: string | null }> {
	const source = await db.selectFrom('transcriptions').selectAll().where('id', '=', sourceId).executeTakeFirst();
	if (!source) throw new Error(`Transcription ${sourceId} was not found.`);

	const sourceTranscriptionId = requireId(source.id, 'source transcription');
	const canonicalTranscriptionId = getCanonicalTranscriptionId(source);
	if (source.scope_type === 'project_snapshot' && source.project_id === projectId) {
		await insertProjectTranscriptionRow(db, projectId, sourceTranscriptionId, canonicalTranscriptionId, now);
		return { transcriptionId: sourceTranscriptionId, canonicalTranscriptionId };
	}

	const snapshotId = createId();
	await db.insertInto('transcriptions').values(buildProjectSnapshotRow(source, projectId, snapshotId, now)).execute();
	await copyVerseIndexRows(db, sourceTranscriptionId, snapshotId, now);
	await copyIiifRows(db, sourceTranscriptionId, snapshotId);
	await insertProjectTranscriptionRow(db, projectId, snapshotId, canonicalTranscriptionId, now);
	return { transcriptionId: snapshotId, canonicalTranscriptionId };
}

async function insertProjectTranscriptionRow(
	db: DbExecutor,
	projectId: string,
	transcriptionId: string,
	canonicalTranscriptionId: string | null,
	now: string,
): Promise<void> {
	const row: Selectable<ProjectTranscriptions> = {
		id: createId(),
		project_id: projectId,
		transcription_id: transcriptionId,
		canonical_transcription_id: canonicalTranscriptionId,
		added_at: now,
		added_by_id: null,
	};
	await db
		.insertInto('project_transcriptions')
		.values(row)
		.onConflict((oc) => oc.columns(['project_id', 'transcription_id']).doNothing())
		.execute();
}

function buildProjectSnapshotRow(
	source: Selectable<Transcriptions>,
	projectId: string,
	snapshotId: string,
	now: string,
): Selectable<Transcriptions> {
	const sourceId = requireId(source.id, 'source transcription');
	const hasCommittedSource = Boolean(source.current_revision_id && source.current_content_hash);
	return {
		...source,
		id: snapshotId,
		scope_type: 'project_snapshot',
		project_id: projectId,
		origin_type: source.scope_type === 'global' ? 'canonical' : source.scope_type,
		origin_project_id: source.project_id,
		origin_transcription_id: sourceId,
		origin_revision_id: hasCommittedSource ? source.current_revision_id : '',
		origin_content_hash: hasCommittedSource ? source.current_content_hash : '',
		current_revision_id: '',
		current_content_hash: '',
		created_at: now,
		updated_at: now,
	};
}

function getCanonicalTranscriptionId(source: Selectable<Transcriptions>): string | null {
	const sourceId = requireId(source.id, 'source transcription');
	if (source.scope_type === 'global') return sourceId;
	return source.origin_type === 'canonical' ? source.origin_transcription_id : null;
}

async function copyVerseIndexRows(
	db: DbExecutor,
	sourceTranscriptionId: string,
	snapshotId: string,
	now: string,
): Promise<void> {
	const rows = await db
		.selectFrom('transcription_verse_index')
		.selectAll()
		.where('transcription_id', '=', sourceTranscriptionId)
		.execute();
	if (rows.length === 0) return;
	const copiedRows: Selectable<TranscriptionVerseIndex>[] = rows.map((row) => ({
		...row,
		id: createId(),
		transcription_id: snapshotId,
		last_indexed_at: now,
	}));
	await db.insertInto('transcription_verse_index').values(copiedRows).execute();
}

async function copyIiifRows(db: DbExecutor, sourceTranscriptionId: string, snapshotId: string): Promise<void> {
	const manifestRows = await db
		.selectFrom('iiif_manifest_sources')
		.selectAll()
		.where('transcription_id', '=', sourceTranscriptionId)
		.execute();
	const manifestIdMap = new Map<string, string>();
	const copiedManifestRows: Selectable<IiifManifestSources>[] = manifestRows.map((row) => {
		const nextId = createId();
		manifestIdMap.set(requireId(row.id, 'manifest source'), nextId);
		return { ...row, id: nextId, transcription_id: snapshotId };
	});
	if (copiedManifestRows.length > 0) await db.insertInto('iiif_manifest_sources').values(copiedManifestRows).execute();

	const pageLinkRows = await db
		.selectFrom('transcription_page_canvas_links')
		.selectAll()
		.where('transcription_id', '=', sourceTranscriptionId)
		.execute();
	const copiedPageLinkRows: Selectable<TranscriptionPageCanvasLinks>[] = pageLinkRows.flatMap((row) => {
		const manifestSourceId = manifestIdMap.get(row.manifest_source_id);
		return manifestSourceId ? [{ ...row, id: createId(), transcription_id: snapshotId, manifest_source_id: manifestSourceId }] : [];
	});
	if (copiedPageLinkRows.length > 0) await db.insertInto('transcription_page_canvas_links').values(copiedPageLinkRows).execute();

	const annotationRows = await db
		.selectFrom('iiif_canvas_annotations')
		.selectAll()
		.where('transcription_id', '=', sourceTranscriptionId)
		.execute();
	const copiedAnnotationRows: Selectable<IiifCanvasAnnotations>[] = annotationRows.flatMap((row) => {
		const manifestSourceId = manifestIdMap.get(row.manifest_source_id);
		return manifestSourceId ? [{ ...row, id: createId(), transcription_id: snapshotId, manifest_source_id: manifestSourceId }] : [];
	});
	if (copiedAnnotationRows.length > 0) await db.insertInto('iiif_canvas_annotations').values(copiedAnnotationRows).execute();
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

function mapProjectTranscriptionOption(
	row: Pick<Selectable<Transcriptions>, 'id' | 'siglum' | 'title' | 'description'>,
): ProjectTranscriptionOption {
	return {
		id: requireId(row.id, 'transcription'),
		siglum: row.siglum,
		displayLabel: getPreferredTranscriptionLabel(row),
		title: row.title,
		description: row.description,
	};
}

function getPreferredTranscriptionLabel(row: Pick<Selectable<Transcriptions>, 'id' | 'siglum'>): string {
	return row.siglum.trim() || requireId(row.id, 'transcription');
}

function isNonEmptyString(value: string | null): value is string {
	return typeof value === 'string' && value.length > 0;
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
