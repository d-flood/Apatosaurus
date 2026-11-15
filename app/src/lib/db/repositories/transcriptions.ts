import { sql, type Kysely, type Selectable } from 'kysely';

import {
	coerceTranscriptionDocument,
	EMPTY_TRANSCRIPTION_DOC,
	TRANSCRIPTION_FORMAT,
	type StoredTranscriptionDocument,
} from '$lib/transcription/content';
import { hashContent } from '$lib/storage/content-hash';
import { collectDocumentHandOptions } from '$lib/transcription/hands';
import {
	compressVerseSliceChunk,
	decompressVerseSliceChunk,
	indexVerseSlices,
	sliceDocumentByVerse,
	sliceVerseFromChunks,
} from '$lib/transcription/verse-slices';
import type {
	Database,
	ProjectTranscriptions,
	TranscriptionSliceChunks,
	TranscriptionVerseIndex,
	Transcriptions,
} from '../types.generated';
import { ensureDefaultProject } from './project-bootstrap';
import { createId, requireId } from './id';
import { loadTranscriptionContentHash } from './revisions';
import type { DbExecutor } from '../worker-kysely';

export type TranscriptionSummary = Omit<
	Pick<Selectable<Transcriptions>, 'id' | 'title' | 'siglum' | 'created_at' | 'updated_at'>,
	'id'
> & { id: string };

export type TranscriptionRecord = Omit<Selectable<Transcriptions>, 'is_public' | 'tags'> & {
	id: string;
	is_public: boolean;
	tags: string[];
};

// Larger chunks compress better but cost each gather more parsing.
const SLICE_CHUNK_LENGTH = 8_000;

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

export interface UpdateTranscriptionMetadataInput {
	id: string;
	title: string;
	siglum: string;
	description: string;
	tags: string[];
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
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

interface NormalizedTranscriptionContent {
	contentJson: string;
	document: StoredTranscriptionDocument;
}

interface ReplaceVerseIndexRowsInput extends NormalizedTranscriptionContent {
	indexedAt?: string;
	force?: boolean;
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
	db: DbExecutor,
	input: CreateTranscriptionInput
): Promise<string> {
	const ids = await createTranscriptions(db, [input]);
	return ids[0];
}

export async function createTranscriptions(
	db: DbExecutor,
	inputs: CreateTranscriptionInput[]
): Promise<string[]> {
	if (inputs.length === 0) return [];
	const create = async (trx: DbExecutor) => {
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
		}));
		await trx.insertInto('project_transcriptions').values(projectTranscriptionRows).execute();
		for (const row of transcriptionRows)
			await replaceVerseIndexRows(trx, requireId(row.id, 'transcription'), {
				...normalizeTranscriptionContent({ contentJson: row.content_json }),
			});
		const touchedAt = new Date().toISOString();
		for (const projectId of [...new Set(rows.map(row => row.projectId))]) {
			await trx
				.updateTable('projects')
				.set({ updated_at: touchedAt })
				.where('id', '=', projectId)
				.execute();
		}
		return transcriptionRows.map(row => requireId(row.id, 'transcription'));
	};
	return 'isTransaction' in db && db.isTransaction === true
		? create(db)
		: db.transaction().execute(create);
}

export async function updateTranscriptionContent(
	db: Kysely<Database>,
	input: UpdateTranscriptionContentInput
): Promise<void> {
	const content = normalizeTranscriptionContent(input);
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
				content_json: content.contentJson,
				format: input.format ?? TRANSCRIPTION_FORMAT,
				updated_at: updatedAt,
			})
			.where('id', '=', input.id)
			.executeTakeFirst();

		if (Number(result.numUpdatedRows) === 0)
			throw new Error(`Transcription ${input.id} was not found.`);
		await replaceVerseIndexRows(trx, input.id, { ...content, indexedAt: updatedAt });
		if (projectRow?.project_id) {
			await trx
				.updateTable('projects')
				.set({ updated_at: updatedAt })
				.where('id', '=', projectRow.project_id)
				.execute();
		}
	});
}

export async function updateTranscriptionMetadata(
	db: DbExecutor,
	input: UpdateTranscriptionMetadataInput
): Promise<void> {
	const result = await db
		.updateTable('transcriptions')
		.set({
			title: input.title.trim(),
			siglum: input.siglum.trim(),
			description: input.description.trim(),
			tags: JSON.stringify(input.tags),
			transcriber: input.transcriber.trim(),
			repository: input.repository.trim(),
			settlement: input.settlement.trim(),
			language: input.language.trim(),
			updated_at: input.updatedAt ?? new Date().toISOString(),
		})
		.where('id', '=', input.id)
		.executeTakeFirst();
	if (Number(result.numUpdatedRows) === 0)
		throw new Error(`Transcription ${input.id} was not found.`);
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
	if (transcriptionIds !== undefined) {
		const uniqueIds = uniqueNonEmpty(transcriptionIds);
		if (uniqueIds.length === 0) return [];
		query = query.where('transcription_id', 'in', uniqueIds);
	}
	const rows = await query.orderBy('transcription_id').execute();
	return rows.map(row => ({ ...row, id: requireId(row.id, 'verse index row') }));
}

export interface CurrentVerseSource {
	transcriptionId: string;
	siglum: string;
	document: StoredTranscriptionDocument;
	contentHash: string;
}

export async function getCurrentVerseSources(
	db: DbExecutor,
	verseIdentifier: string,
	transcriptionIds: string[]
): Promise<CurrentVerseSource[]> {
	const ids = uniqueNonEmpty(transcriptionIds);
	if (ids.length === 0) return [];
	const rows = await db
		.selectFrom('transcriptions')
		.innerJoin('project_transcriptions', join =>
			join
				.onRef('project_transcriptions.transcription_id', '=', 'transcriptions.id')
				.onRef('project_transcriptions.project_id', '=', 'transcriptions.project_id')
		)
		.leftJoin(
			'transcription_verse_index_state',
			'transcription_verse_index_state.transcription_id',
			'transcriptions.id'
		)
		.leftJoin('transcription_verse_index', join =>
			join
				.onRef('transcription_verse_index.transcription_id', '=', 'transcriptions.id')
				.on('transcription_verse_index.verse_identifier', '=', verseIdentifier)
		)
		.select([
			'transcriptions.id as id',
			'transcriptions.siglum as siglum',
			'project_transcriptions.id as project_transcription_id',
			'transcription_verse_index_state.document_shell_json as document_shell_json',
			'transcription_verse_index.id as verse_index_id',
			'transcription_verse_index.slice_first_chunk as slice_first_chunk',
			'transcription_verse_index.slice_last_chunk as slice_last_chunk',
		])
		.where('transcriptions.id', 'in', ids)
		.execute();
	const chunksById = await loadSliceChunks(
		db,
		rows.flatMap(row =>
			row.slice_first_chunk === null || row.slice_last_chunk === null
				? []
				: [
						[
							requireId(row.id, 'transcription'),
							row.slice_first_chunk,
							row.slice_last_chunk,
						] as const,
					]
		)
	);
	const byId = new Map(rows.map(row => [row.id, row]));
	const sources: CurrentVerseSource[] = [];
	for (const id of ids) {
		const row = byId.get(id);
		if (!row) continue;
		sources.push({
			transcriptionId: id,
			siglum: row.siglum,
			document:
				row.document_shell_json !== null && row.verse_index_id !== null
					? {
							...JSON.parse(row.document_shell_json),
							pages: sliceVerseFromChunks(chunksById.get(id) ?? [], verseIdentifier),
						}
					: await sliceStoredContent(db, id, verseIdentifier),
			contentHash: await loadTranscriptionContentHash(
				db,
				requireId(row.project_transcription_id, 'project transcription')
			),
		});
	}
	return sources;
}

/** Inflates, per transcription and in order, the chunks each range covers. */
async function loadSliceChunks(
	db: DbExecutor,
	ranges: Array<readonly [transcriptionId: string, firstChunk: number, lastChunk: number]>
): Promise<Map<string, string[]>> {
	if (ranges.length === 0) return new Map();
	const { rows } = await sql<
		Pick<TranscriptionSliceChunks, 'transcription_id' | 'chunk_deflated'>
	>`
		SELECT chunk.transcription_id, chunk.chunk_deflated
		FROM json_each(${JSON.stringify(ranges)}) AS range
		JOIN transcription_slice_chunks AS chunk
			ON chunk.transcription_id = range.value ->> 0
			AND chunk.chunk_index BETWEEN range.value ->> 1 AND range.value ->> 2
		ORDER BY chunk.transcription_id, chunk.chunk_index
	`.execute(db);
	const byId = new Map<string, string[]>();
	for (const row of rows) {
		const chunks = byId.get(row.transcription_id) ?? [];
		chunks.push(decompressVerseSliceChunk(row.chunk_deflated));
		byId.set(row.transcription_id, chunks);
	}
	return byId;
}

async function sliceStoredContent(
	db: DbExecutor,
	transcriptionId: string,
	verseIdentifier: string
): Promise<StoredTranscriptionDocument> {
	const row = await db
		.selectFrom('transcriptions')
		.select('content_json')
		.where('id', '=', transcriptionId)
		.executeTakeFirstOrThrow();
	const { document } = normalizeTranscriptionContent({ contentJson: row.content_json });
	const pages = sliceDocumentByVerse(document, [verseIdentifier]).get(verseIdentifier) ?? [];
	return { ...document, pages };
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
	return listVerseIndexRowsForTranscriptions(db, [transcriptionId]);
}

export async function listVerseIndexRowsForTranscriptions(
	db: DbExecutor,
	transcriptionIds: string[]
): Promise<VerseIndexRow[]> {
	const uniqueIds = uniqueNonEmpty(transcriptionIds);
	if (uniqueIds.length === 0) return [];
	const rows = await db
		.selectFrom('transcription_verse_index')
		.selectAll()
		.where('transcription_id', 'in', uniqueIds)
		.orderBy('transcription_id')
		.orderBy('verse_identifier')
		.execute();
	return rows.map(row => ({ ...row, id: requireId(row.id, 'verse index row') }));
}

export interface VerseCount {
	identifier: string;
	book: string;
	chapter: string;
	verse: string;
	count: number;
}

export async function listVerseCountsForTranscriptions(
	db: DbExecutor,
	transcriptionIds: string[]
): Promise<VerseCount[]> {
	const uniqueIds = uniqueNonEmpty(transcriptionIds);
	if (uniqueIds.length === 0) return [];
	return db
		.selectFrom('transcription_verse_index')
		.select(eb => [
			'verse_identifier as identifier',
			'book',
			'chapter',
			'verse',
			eb.fn.countAll<number>().as('count'),
		])
		.where('transcription_id', 'in', uniqueIds)
		.groupBy('verse_identifier')
		.execute();
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
				await replaceVerseIndexRows(trx, id, {
					...normalizeTranscriptionContent({ contentJson: row.content_json }),
				});
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
	await replaceVerseIndexRows(db, transcriptionId, {
		...normalizeTranscriptionContent({ contentJson }),
		indexedAt,
	});
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
		origin_captured_at: '',
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
	input: ReplaceVerseIndexRowsInput
): Promise<void> {
	const indexedAt = input.indexedAt ?? new Date().toISOString();
	// A key-order change only costs a redundant reindex, so skip canonical JSON.
	const contentHash = await hashContent(input.contentJson);
	if (!input.force && (await isVerseIndexCurrent(db, transcriptionId, contentHash))) return;

	await db
		.deleteFrom('transcription_verse_index')
		.where('transcription_id', '=', transcriptionId)
		.execute();

	const uniqueByIdentifier = new Map<string, VerseNode>();
	for (const verse of extractVersesFromDocument(input.document)) {
		const identifier = normalizeVerseIdentifier(verse);
		if (!identifier || uniqueByIdentifier.has(identifier)) continue;
		uniqueByIdentifier.set(identifier, verse);
	}

	const slices = indexVerseSlices(input.document, uniqueByIdentifier.keys(), SLICE_CHUNK_LENGTH);
	const rows: Selectable<TranscriptionVerseIndex>[] = [...uniqueByIdentifier].map(
		([identifier, verse]) => ({
			id: createId(),
			transcription_id: transcriptionId,
			verse_identifier: identifier,
			book: verse.book,
			chapter: verse.chapter,
			verse: verse.verse,
			last_indexed_at: indexedAt,
			slice_first_chunk: slices.ranges.get(identifier)?.[0] ?? null,
			slice_last_chunk: slices.ranges.get(identifier)?.[1] ?? null,
		})
	);

	if (rows.length > 0) await db.insertInto('transcription_verse_index').values(rows).execute();
	await replaceSliceChunks(db, transcriptionId, slices.chunks);
	const { pages: _pages, ...documentShell } = input.document;
	const state = {
		indexed_content_hash: contentHash,
		verse_count: rows.length,
		last_indexed_at: indexedAt,
		document_shell_json: JSON.stringify(documentShell),
		hands_json: JSON.stringify(collectDocumentHandOptions(input.document)),
	};
	await db
		.insertInto('transcription_verse_index_state')
		.values({ transcription_id: transcriptionId, ...state })
		.onConflict(oc => oc.column('transcription_id').doUpdateSet(state))
		.execute();
}

async function replaceSliceChunks(
	db: DbExecutor,
	transcriptionId: string,
	chunks: string[]
): Promise<void> {
	const stale = new Map(
		(
			await db
				.selectFrom('transcription_slice_chunks')
				.select(['chunk_index', 'chunk_hash'])
				.where('transcription_id', '=', transcriptionId)
				.execute()
		).map(row => [row.chunk_index, row.chunk_hash])
	);
	const hashes = await Promise.all(
		chunks.map(async json => (await hashContent(json)).slice(-16))
	);
	const changed: Selectable<TranscriptionSliceChunks>[] = [];
	chunks.forEach((json, chunkIndex) => {
		const previous = stale.get(chunkIndex);
		stale.delete(chunkIndex);
		if (previous === hashes[chunkIndex]) return;
		changed.push({
			transcription_id: transcriptionId,
			chunk_index: chunkIndex,
			chunk_hash: hashes[chunkIndex],
			chunk_deflated: compressVerseSliceChunk(json),
		});
	});
	if (stale.size > 0)
		await db
			.deleteFrom('transcription_slice_chunks')
			.where('transcription_id', '=', transcriptionId)
			.where('chunk_index', 'in', [...stale.keys()])
			.execute();
	if (changed.length > 0)
		await db
			.insertInto('transcription_slice_chunks')
			.values(changed)
			.onConflict(oc =>
				oc.columns(['transcription_id', 'chunk_index']).doUpdateSet({
					chunk_hash: eb => eb.ref('excluded.chunk_hash'),
					chunk_deflated: eb => eb.ref('excluded.chunk_deflated'),
				})
			)
			.execute();
}

async function isVerseIndexCurrent(
	db: DbExecutor,
	transcriptionId: string,
	contentHash: string
): Promise<boolean> {
	const state = await db
		.selectFrom('transcription_verse_index_state')
		.select(['indexed_content_hash', 'verse_count'])
		.where('transcription_id', '=', transcriptionId)
		.executeTakeFirst();
	if (!state || state.indexed_content_hash !== contentHash) return false;

	const count = await db
		.selectFrom('transcription_verse_index')
		.select(eb => eb.fn.countAll<number>().as('count'))
		.where('transcription_id', '=', transcriptionId)
		.executeTakeFirst();
	return Number(count?.count ?? 0) === state.verse_count;
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
	return normalizeTranscriptionContent(input).contentJson;
}

function normalizeTranscriptionContent(
	input: Pick<CreateTranscriptionInput, 'contentJson' | 'document'>
): NormalizedTranscriptionContent {
	const document = input.document
		? coerceTranscriptionDocument(input.document)
		: coerceTranscriptionDocument(input.contentJson || EMPTY_TRANSCRIPTION_DOC);
	if (!document) throw new Error('Transcription content is missing or invalid');
	return { document, contentJson: JSON.stringify(document) };
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
