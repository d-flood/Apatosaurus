import { nanoid } from 'nanoid';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';

import {
	coerceTranscriptionDocument,
	EMPTY_TRANSCRIPTION_DOC,
	serializeTranscriptionDocument,
	TRANSCRIPTION_FORMAT,
	type StoredTranscriptionDocument,
} from '$lib/client/transcription/content';
import type {
	Database,
	ProjectTranscriptions,
	TranscriptionVerseIndex,
	Transcriptions,
} from '../types.generated';
import { ensureDefaultProject } from './project-bootstrap';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type TranscriptionSummary = Omit<
	Pick<Selectable<Transcriptions>, 'id' | 'title' | 'siglum' | 'created_at' | 'updated_at'>,
	'id'
> & { id: string };

export type TranscriptionVersion = Omit<
	Pick<Selectable<Transcriptions>, 'id' | 'updated_at'>,
	'id'
> & { id: string };

export type TranscriptionRecord = Omit<Selectable<Transcriptions>, 'is_public' | 'tags'> & {
	id: string;
	is_public: boolean;
	tags: string[];
};

export type VerseIndexRow = Selectable<TranscriptionVerseIndex> & { id: string };

export interface CreateTranscriptionInput {
	id?: string;
	projectId?: string;
	projectTranscriptionId?: string;
	canonicalTranscriptionId?: string | null;
	title: string;
	siglum: string;
	description?: string;
	document?: StoredTranscriptionDocument | null;
	contentJson?: string;
	format?: string;
	createdAt?: string;
	updatedAt?: string;
	owner?: string | null;
	isPublic?: boolean;
	tags?: string[];
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
}

export interface UpdateTranscriptionContentInput {
	id: string;
	document?: StoredTranscriptionDocument | null;
	contentJson?: string;
	format?: string;
	updatedAt?: string;
}

export interface VerseIndexRebuildFailure {
	transcriptionId: string;
	label: string;
	message: string;
}

export interface VerseIndexRebuildResult {
	processed: number;
	succeeded: number;
	failed: number;
	failures: VerseIndexRebuildFailure[];
}

interface VerseNode {
	book: string;
	chapter: string;
	verse: string;
}

export async function listTranscriptionSummaries(db: DbExecutor): Promise<TranscriptionSummary[]> {
	if (import.meta.env.DEV) await logSummaryQueryPlan(db);
	const startedAt = now();
	const rows = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select([
			'transcriptions.id as id',
			'transcriptions.title as title',
			'transcriptions.siglum as siglum',
			'transcriptions.created_at as created_at',
			'transcriptions.updated_at as updated_at',
		])
		.orderBy('transcriptions.updated_at', 'desc')
		.execute();
	console.debug('[local-db] transcriptions.listSummaries query completed', {
		rowCount: rows.length,
		elapsedMs: elapsed(startedAt),
	});

	return rows.map(row => ({ ...row, id: requireId(row.id, 'transcription') }));
}

export async function getTranscriptionSummary(
	db: DbExecutor,
	id: string
): Promise<TranscriptionSummary | null> {
	const row = await db
		.selectFrom('transcriptions')
		.select(['id', 'title', 'siglum', 'created_at', 'updated_at'])
		.where('id', '=', id)
		.executeTakeFirst();
	return row ? { ...row, id: requireId(row.id, 'transcription') } : null;
}

export async function getTranscriptionVersionsByIds(
	db: DbExecutor,
	ids: string[]
): Promise<TranscriptionVersion[]> {
	const uniqueIds = uniqueNonEmpty(ids);
	if (uniqueIds.length === 0) return [];
	const rows = await db
		.selectFrom('transcriptions')
		.select(['id', 'updated_at'])
		.where('id', 'in', uniqueIds)
		.execute();
	const byId = new Map(
		rows.map(row => [row.id, { ...row, id: requireId(row.id, 'transcription') }])
	);
	return uniqueIds.flatMap(id => {
		const row = byId.get(id);
		return row ? [row] : [];
	});
}

export async function getTranscription(
	db: DbExecutor,
	id: string
): Promise<TranscriptionRecord | null> {
	const row = await db
		.selectFrom('transcriptions')
		.selectAll()
		.where('id', '=', id)
		.executeTakeFirst();
	return row ? mapTranscription(row) : null;
}

export async function getTranscriptionsByIds(
	db: DbExecutor,
	ids: string[]
): Promise<TranscriptionRecord[]> {
	const uniqueIds = uniqueNonEmpty(ids);
	if (uniqueIds.length === 0) return [];
	const rows = await db
		.selectFrom('transcriptions')
		.selectAll()
		.where('id', 'in', uniqueIds)
		.execute();
	const byId = new Map(rows.map(row => [row.id, mapTranscription(row)]));
	return uniqueIds.flatMap(id => {
		const row = byId.get(id);
		return row ? [row] : [];
	});
}

export async function createTranscription(
	db: Kysely<Database>,
	input: CreateTranscriptionInput
): Promise<string> {
	const ids = await createTranscriptions(db, [input]);
	return ids[0];
}

export async function createTranscriptions(
	db: Kysely<Database>,
	inputs: CreateTranscriptionInput[]
): Promise<string[]> {
	if (inputs.length === 0) return [];
	return db.transaction().execute(async trx => {
		const defaultProjectId = inputs.some(input => !input.projectId?.trim())
			? await ensureDefaultProject(trx)
			: null;
		const rows = inputs.map(input => {
			const projectId = input.projectId?.trim() || defaultProjectId;
			if (!projectId) throw new Error('A project id is required to create a transcription.');
			return {
				input,
				projectId,
				transcription: buildTranscriptionRow(input, projectId),
			};
		});
		const transcriptionRows = rows.map(row => row.transcription);
		await trx.insertInto('transcriptions').values(transcriptionRows).execute();
		const projectTranscriptionRows: Selectable<ProjectTranscriptions>[] = rows.map(row => ({
			id: row.input.projectTranscriptionId ?? createId(),
			project_id: row.projectId,
			transcription_id: requireId(row.transcription.id, 'transcription'),
			canonical_transcription_id: row.input.canonicalTranscriptionId ?? null,
			added_at: row.transcription.created_at,
			added_by_id: null,
		}));
		await trx.insertInto('project_transcriptions').values(projectTranscriptionRows).execute();
		for (const row of transcriptionRows)
			await replaceVerseIndexRows(trx, requireId(row.id, 'transcription'), row.content_json);
		const touchedAt = new Date().toISOString();
		for (const projectId of [...new Set(rows.map(row => row.projectId))]) {
			await trx
				.updateTable('projects')
				.set({ updated_at: touchedAt })
				.where('id', '=', projectId)
				.execute();
		}
		return transcriptionRows.map(row => requireId(row.id, 'transcription'));
	});
}

export async function updateTranscriptionContent(
	db: Kysely<Database>,
	input: UpdateTranscriptionContentInput
): Promise<void> {
	const contentJson = getContentJson(input);
	const updatedAt = input.updatedAt ?? new Date().toISOString();
	await db.transaction().execute(async trx => {
		const projectRow = await trx
			.selectFrom('transcriptions')
			.select('project_id')
			.where('id', '=', input.id)
			.executeTakeFirst();
		const result = await trx
			.updateTable('transcriptions')
			.set({
				content_json: contentJson,
				format: input.format ?? TRANSCRIPTION_FORMAT,
				updated_at: updatedAt,
			})
			.where('id', '=', input.id)
			.executeTakeFirst();

		if (Number(result.numUpdatedRows) === 0)
			throw new Error(`Transcription ${input.id} was not found.`);
		await replaceVerseIndexRows(trx, input.id, contentJson, updatedAt);
		if (projectRow?.project_id) {
			await trx
				.updateTable('projects')
				.set({ updated_at: updatedAt })
				.where('id', '=', projectRow.project_id)
				.execute();
		}
	});
}

export async function deleteTranscription(db: DbExecutor, id: string): Promise<void> {
	await db.deleteFrom('transcriptions').where('id', '=', id).execute();
}

export async function getVerseIndexRowsForVerse(
	db: DbExecutor,
	verseIdentifier: string,
	transcriptionIds?: string[]
): Promise<VerseIndexRow[]> {
	let query = db
		.selectFrom('transcription_verse_index')
		.selectAll()
		.where('verse_identifier', '=', verseIdentifier);
	const uniqueIds = uniqueNonEmpty(transcriptionIds ?? []);
	if (uniqueIds.length > 0) query = query.where('transcription_id', 'in', uniqueIds);
	const rows = await query.orderBy('transcription_id').execute();
	return rows.map(row => ({ ...row, id: requireId(row.id, 'verse index row') }));
}

export async function listVerseIndexRows(db: DbExecutor): Promise<VerseIndexRow[]> {
	const rows = await db
		.selectFrom('transcription_verse_index')
		.selectAll()
		.orderBy('transcription_id')
		.orderBy('verse_identifier')
		.execute();
	return rows.map(row => ({ ...row, id: requireId(row.id, 'verse index row') }));
}

export async function listVerseIndexRowsForTranscription(
	db: DbExecutor,
	transcriptionId: string
): Promise<VerseIndexRow[]> {
	const rows = await db
		.selectFrom('transcription_verse_index')
		.selectAll()
		.where('transcription_id', '=', transcriptionId)
		.orderBy('verse_identifier')
		.execute();
	return rows.map(row => ({ ...row, id: requireId(row.id, 'verse index row') }));
}

export async function rebuildVerseIndexForTranscriptions(
	db: Kysely<Database>,
	transcriptionIds: string[]
): Promise<VerseIndexRebuildResult> {
	const ids = uniqueNonEmpty(transcriptionIds);
	if (ids.length === 0) return { processed: 0, succeeded: 0, failed: 0, failures: [] };

	const failures: VerseIndexRebuildFailure[] = [];
	let succeeded = 0;

	await db.transaction().execute(async trx => {
		for (const id of ids) {
			const row = await trx
				.selectFrom('transcriptions')
				.select(['id', 'siglum', 'title', 'content_json'])
				.where('id', '=', id)
				.executeTakeFirst();
			const label = row ? formatTranscriptionLabel(row) : id;
			try {
				if (!row) throw new Error('Transcription was not found');
				await replaceVerseIndexRows(trx, id, row.content_json);
				succeeded += 1;
			} catch (error) {
				failures.push({
					transcriptionId: id,
					label,
					message:
						error instanceof Error ? error.message : 'Failed to rebuild verse index',
				});
			}
		}
	});

	return {
		processed: ids.length,
		succeeded,
		failed: failures.length,
		failures,
	};
}

export async function replaceTranscriptionVerseIndexRows(
	db: DbExecutor,
	transcriptionId: string,
	contentJson: string,
	indexedAt: string = new Date().toISOString()
): Promise<void> {
	await replaceVerseIndexRows(db, transcriptionId, contentJson, indexedAt);
}

function buildTranscriptionRow(
	input: CreateTranscriptionInput,
	projectId: string
): Selectable<Transcriptions> {
	const now = new Date().toISOString();
	return {
		id: input.id ?? createId(),
		project_id: projectId,
		origin_type: '',
		origin_project_id: null,
		origin_transcription_id: null,
		origin_revision_id: '',
		origin_content_hash: '',
		current_revision_id: '',
		current_content_hash: '',
		title: input.title.trim(),
		siglum: input.siglum.trim(),
		description: input.description?.trim() || '',
		content_json: getContentJson(input),
		format: input.format ?? TRANSCRIPTION_FORMAT,
		created_at: input.createdAt ?? now,
		updated_at: input.updatedAt ?? input.createdAt ?? now,
		owner: input.owner ?? null,
		is_public: input.isPublic ? 1 : 0,
		tags: JSON.stringify(input.tags ?? []),
		transcriber: input.transcriber.trim(),
		repository: input.repository.trim(),
		settlement: input.settlement.trim(),
		language: input.language.trim(),
	};
}

async function replaceVerseIndexRows(
	db: DbExecutor,
	transcriptionId: string,
	contentJson: string,
	indexedAt: string = new Date().toISOString()
): Promise<void> {
	const document = coerceTranscriptionDocument(contentJson);
	if (!document) throw new Error('Transcription content is missing or invalid');

	await db
		.deleteFrom('transcription_verse_index')
		.where('transcription_id', '=', transcriptionId)
		.execute();

	const uniqueByIdentifier = new Map<string, VerseNode>();
	for (const verse of extractVersesFromDocument(document)) {
		const identifier = normalizeVerseIdentifier(verse);
		if (!identifier || uniqueByIdentifier.has(identifier)) continue;
		uniqueByIdentifier.set(identifier, verse);
	}

	const rows: Selectable<TranscriptionVerseIndex>[] = [...uniqueByIdentifier].map(
		([identifier, verse]) => ({
			id: createId(),
			transcription_id: transcriptionId,
			verse_identifier: identifier,
			book: verse.book,
			chapter: verse.chapter,
			verse: verse.verse,
			last_indexed_at: indexedAt,
		})
	);

	if (rows.length > 0) await db.insertInto('transcription_verse_index').values(rows).execute();
}

function extractVersesFromDocument(document: StoredTranscriptionDocument): VerseNode[] {
	const verses: VerseNode[] = [];
	const state: VerseNode = { book: '', chapter: '', verse: '' };

	for (const page of document.pages) {
		for (const column of page.columns) {
			for (const line of column.lines) {
				for (const item of line.items) {
					if (item.type !== 'milestone') continue;
					if (item.kind === 'book') state.book = item.attrs.book || state.book;
					if (item.kind === 'chapter') {
						state.book = item.attrs.book || state.book;
						state.chapter = item.attrs.chapter || state.chapter;
					}
					if (item.kind === 'verse') {
						state.book = item.attrs.book || state.book;
						state.chapter = item.attrs.chapter || state.chapter;
						state.verse = item.attrs.verse || state.verse;
						verses.push({ ...state });
					}
				}
			}
		}
	}

	return verses;
}

function normalizeVerseIdentifier(verse: VerseNode): string {
	const { book, chapter, verse: verseNum } = verse;
	if (!book && !chapter && !verseNum) return 'Unknown';
	if (!chapter && !verseNum) return book;
	if (!chapter) return `${book} ${verseNum}`;
	if (!verseNum) return `${book} ${chapter}`;
	return `${book} ${chapter}:${verseNum}`;
}

function getContentJson(input: Pick<CreateTranscriptionInput, 'contentJson' | 'document'>): string {
	if (input.contentJson) return input.contentJson;
	return serializeTranscriptionDocument(input.document || EMPTY_TRANSCRIPTION_DOC);
}

function mapTranscription(row: Selectable<Transcriptions>): TranscriptionRecord {
	return {
		...row,
		id: requireId(row.id, 'transcription'),
		is_public: row.is_public === 1,
		tags: parseTags(row.tags),
	};
}

function parseTags(value: string): string[] {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((tag): tag is string => typeof tag === 'string')
			: [];
	} catch {
		return [];
	}
}

function uniqueNonEmpty(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function formatTranscriptionLabel(
	row: Pick<Selectable<Transcriptions>, 'id' | 'siglum' | 'title'>
): string {
	return row.siglum?.trim() || row.title?.trim() || requireId(row.id, 'transcription');
}

function requireId(id: string | null, recordType: string): string {
	if (!id) throw new Error(`Missing ${recordType} id.`);
	return id;
}

async function logSummaryQueryPlan(db: DbExecutor): Promise<void> {
	const startedAt = now();
	try {
		const result = await sql`EXPLAIN QUERY PLAN
			SELECT transcriptions.id, title, siglum, created_at, updated_at
			FROM project_transcriptions
			INNER JOIN transcriptions ON transcriptions.id = project_transcriptions.transcription_id
			ORDER BY transcriptions.updated_at DESC`.execute(db);
		console.debug('[local-db] transcriptions.listSummaries query plan', {
			rows: result.rows,
			elapsedMs: elapsed(startedAt),
		});
	} catch (error) {
		console.warn('[local-db] transcriptions.listSummaries query plan failed', {
			elapsedMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function now(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function elapsed(startedAt: number): number {
	return Math.round(now() - startedAt);
}

function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: nanoid();
}
