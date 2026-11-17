import { sql } from 'kysely';
import {
	COLLATION_DOCUMENT_ARTIFACT_TYPE,
	parseCollationDocument,
	serializeCollationDocument,
	type CollationSegment,
} from '$lib/collation/collation-document';
import type { CollationPayload } from '$lib/storage/formats';
import type { JsonObject } from '$lib/storage/envelope';
import { witnessSourceColumns } from '$lib/collation/collation-projection';
import type { WitnessSource } from '$lib/collation/collation-types';
import { type EntityCloudBackupState, type SyncProjectContext } from '$lib/backup/backup-status';
import {
	deriveSourceFreshness,
	loadTranscriptionSourceState,
	type EntityCheckpointHead,
	type EntityCommitState,
	type TranscriptionSourceState,
} from './revisions';
import { requireId } from './id';
import type { DbExecutor } from '../worker-kysely';

export interface CollationListItem {
	id: string;
	projectId: string;
	projectName: string;
	title: string;
	verseIdentifier: string;
	status: string;
	updatedAt: string;
}

export interface CreateCollationInput {
	id?: string;
	projectId: string;
	title: string;
	verseIdentifier: string;
	segment?: CollationSegment;
	now?: string;
}

export interface UpdateCollationMetadataInput {
	id: string;
	title?: string;
	verseIdentifier?: string;
	notes?: string;
	groupPath?: string;
	sortKey?: number;
	updatedAt?: string;
}

export interface CollationArtifactRecord {
	id: string;
	artifactType: string;
	payload: string;
	createdAt: string;
}

interface CollationRecord {
	id: string;
	projectId: string;
	title: string;
	verseIdentifier: string;
	status: string;
	groupPath: string;
	notes: string;
	sortKey: number;
	createdAt: string;
	updatedAt: string;
}

export type CollationWitnessVersionState =
	'no-source' | 'source-missing' | 'up-to-date' | 'source-changed';

export interface CollationWitnessSourceStatus {
	witnessId: string;
	position: number;
	projectTranscriptionId: string | null;
	projectOwnedTranscriptionId: string | null;
	source: WitnessSource | null;
	sourceVersionLabel: string | null;
	versionState: CollationWitnessVersionState;
}

export interface CollationVersionStatus {
	projectId: string;
	projectName: string;
	collationId: string;
	title: string;
	verseIdentifier: string;
	groupPath: string;
	sortKey: number;
	currentCheckpoint: EntityCheckpointHead | null;
	workingContentHash: string;
	dirtyToCheckpoint: boolean;
	commitState: EntityCommitState;
	witnesses: CollationWitnessSourceStatus[];
	cloudBackupState?: EntityCloudBackupState;
}

export interface CollationVersionStatusOptions {
	syncContext?: SyncProjectContext | null;
}

interface SaveCollationProjectionWitnessInput {
	witnessId: string;
	transcriptionId: string | null;
	projectTranscriptionId?: string | null;
	source?: WitnessSource;
	content: string;
	position: number;
}

export interface LoadedCollation {
	row: CollationRecord;
	artifact: CollationArtifactRecord | null;
}

export interface SaveCollationArtifactInput {
	collationId: string;
	artifactType: string;
	payload: string;
	artifactId?: string | null;
	now?: string;
	metadata?: Omit<UpdateCollationMetadataInput, 'id' | 'updatedAt'>;
}

export interface SaveCollationProjectionInput {
	collationId: string;
	witnesses: SaveCollationProjectionWitnessInput[];
	tokens: Array<{ witnessId: string; tokenIndex: number; tokenText: string }>;
	variationUnits: Array<{
		startIndex: number;
		endIndex: number;
		unitType: string;
		baseText: string;
		readings: Array<{
			readingOrder: number;
			readingText: string;
			isOmission: boolean;
			isLacuna: boolean;
			witnessIds: string[];
		}>;
	}>;
}

/** The collations row and cached document of a TEI-canonical collation's Current. */
export function collationIndexRowsFromPayload(projectId: string, payload: CollationPayload) {
	return {
		collation: {
			id: payload.id,
			project_id: projectId,
			current_revision_id: payload.based_on_checkpoint?.id ?? '',
			current_content_hash: payload.based_on_checkpoint?.content_hash ?? '',
			title: payload.title,
			verse_identifier: payload.verse_identifier,
			status: payload.status,
			group_path: payload.group_path,
			notes: payload.notes,
			sort_key: payload.sort_key,
			conflict_of_collation_id: payload.conflict_of_collation_id ?? '',
			created_at: payload.created_at,
			updated_at: payload.updated_at,
		},
		artifact: {
			id: `${payload.id}:document`,
			collation_id: payload.id,
			artifact_type: COLLATION_DOCUMENT_ARTIFACT_TYPE,
			payload: serializeCollationDocument(payload.document),
			created_at: payload.created_at,
		},
	};
}

export async function replaceCollationIndexRows(
	trx: DbExecutor,
	rows: ReturnType<typeof collationIndexRowsFromPayload>
): Promise<void> {
	const { id, ...collation } = rows.collation;
	await trx.updateTable('collations').set(collation).where('id', '=', id).execute();
	const { collation_id: _collationId, artifact_type: _type, ...artifact } = rows.artifact;
	await trx
		.insertInto('collation_artifacts')
		.values(rows.artifact)
		.onConflict(oc => oc.columns(['collation_id', 'artifact_type']).doUpdateSet(artifact))
		.execute();
}

/** Rebuilds a TEI-canonical Current from its index rows; null when the cache is missing. */
export async function loadIndexedCollationPayload(
	db: DbExecutor,
	collationId: string
): Promise<CollationPayload | null> {
	const [row, artifact] = await Promise.all([
		db.selectFrom('collations').selectAll().where('id', '=', collationId).executeTakeFirst(),
		db
			.selectFrom('collation_artifacts')
			.select('payload')
			.where('collation_id', '=', collationId)
			.where('artifact_type', '=', COLLATION_DOCUMENT_ARTIFACT_TYPE)
			.executeTakeFirst(),
	]);
	const document = artifact && parseCollationDocument(artifact.payload);
	if (!row || !document) return null;
	return {
		id: collationId,
		project_id: row.project_id,
		title: row.title,
		verse_identifier: row.verse_identifier,
		status: row.status,
		group_path: row.group_path,
		notes: row.notes,
		sort_key: row.sort_key,
		document: document as typeof document & JsonObject,
		based_on_checkpoint:
			row.current_revision_id && row.current_content_hash
				? { id: row.current_revision_id, content_hash: row.current_content_hash }
				: null,
		draft: { saved_at: row.updated_at, author_name: null },
		created_at: row.created_at,
		updated_at: row.updated_at,
		...(row.conflict_of_collation_id
			? { conflict_of_collation_id: row.conflict_of_collation_id }
			: {}),
	};
}

/** The index's collation row and cached document, its string passed through unparsed. */
export async function loadIndexedCollation(
	db: DbExecutor,
	collationId: string
): Promise<LoadedCollation | null> {
	const [row, artifact] = await Promise.all([
		db.selectFrom('collations').selectAll().where('id', '=', collationId).executeTakeFirst(),
		db
			.selectFrom('collation_artifacts')
			.select(['id', 'payload'])
			.where('collation_id', '=', collationId)
			.where('artifact_type', '=', COLLATION_DOCUMENT_ARTIFACT_TYPE)
			.executeTakeFirst(),
	]);
	if (!row || !artifact) return null;
	return {
		row: {
			id: collationId,
			projectId: row.project_id,
			title: row.title,
			verseIdentifier: row.verse_identifier,
			status: row.status,
			groupPath: row.group_path,
			notes: row.notes,
			sortKey: row.sort_key,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		},
		artifact: {
			id: requireId(artifact.id, 'collation artifact'),
			artifactType: COLLATION_DOCUMENT_ARTIFACT_TYPE,
			payload: artifact.payload,
			createdAt: row.updated_at,
		},
	};
}

export async function listCollationsWithProjectNames(db: DbExecutor): Promise<CollationListItem[]> {
	const rows = await db
		.selectFrom('collations')
		.innerJoin('projects', 'projects.id', 'collations.project_id')
		.select([
			'collations.id as id',
			'collations.project_id as project_id',
			'collations.title as title',
			'collations.verse_identifier as verse_identifier',
			'collations.status as status',
			'collations.updated_at as updated_at',
			'projects.name as project_name',
		])
		.orderBy('collations.updated_at', 'desc')
		.execute();

	return rows.map(row => ({
		id: requireId(row.id, 'collation'),
		projectId: requireId(row.project_id, 'collation project'),
		projectName: row.project_name,
		title: row.title,
		verseIdentifier: row.verse_identifier,
		status: row.status,
		updatedAt: row.updated_at,
	}));
}

export async function getNextCollationSortKey(db: DbExecutor, projectId: string): Promise<number> {
	const row = await db
		.selectFrom('collations')
		.select(eb => eb.fn.max('sort_key').as('max'))
		.where('project_id', '=', projectId)
		.executeTakeFirst();
	return row?.max == null ? 0 : Number(row.max) + 1;
}

export async function deleteCollation(db: DbExecutor, collationId: string): Promise<void> {
	const result = await db
		.deleteFrom('collations')
		.where('id', '=', collationId)
		.executeTakeFirst();
	if (Number(result.numDeletedRows) === 0)
		throw new Error(`Collation ${collationId} was not found.`);
}

export async function createCollation(
	db: DbExecutor,
	input: CreateCollationInput
): Promise<string> {
	const now = input.now ?? new Date().toISOString();
	const id = input.id ?? crypto.randomUUID();
	await db
		.insertInto('collations')
		.values({
			id,
			project_id: input.projectId,
			current_revision_id: '',
			current_content_hash: '',
			title: input.title,
			verse_identifier: input.verseIdentifier,
			status: 'draft',
			group_path: '',
			notes: '',
			sort_key: 0,
			conflict_of_collation_id: '',
			created_at: now,
			updated_at: now,
		})
		.execute();
	return id;
}

export async function saveCollationArtifact(
	db: DbExecutor,
	input: SaveCollationArtifactInput
): Promise<string> {
	const now = input.now ?? new Date().toISOString();
	const artifactId = input.artifactId || crypto.randomUUID();
	await db
		.insertInto('collation_artifacts')
		.values({
			id: artifactId,
			collation_id: input.collationId,
			artifact_type: input.artifactType,
			payload: input.payload,
			created_at: now,
		})
		.onConflict(oc =>
			oc.columns(['collation_id', 'artifact_type']).doUpdateSet({
				id: artifactId,
				payload: input.payload,
			})
		)
		.execute();
	return artifactId;
}

export async function saveCollationProjection(
	db: DbExecutor,
	input: SaveCollationProjectionInput
): Promise<void> {
	const save = async (trx: DbExecutor) => {
		const collation = await trx
			.selectFrom('collations')
			.select(['project_id'])
			.where('id', '=', input.collationId)
			.executeTakeFirst();
		if (!collation) throw new Error(`Collation ${input.collationId} was not found.`);
		const projectTranscriptionIds = await loadWitnessProjectTranscriptionIds(
			trx,
			collation.project_id,
			input.witnesses
		);
		const stored = await loadStoredProjection(trx, input.collationId);

		const witnesses = diffByKey(
			stored.witnesses.map(({ id, ...row }) => ({ key: row.witness_id, id, row })),
			input.witnesses.map(row => ({
				key: row.witnessId,
				row: {
					collation_id: input.collationId,
					witness_id: row.witnessId,
					content: row.content,
					position: row.position,
					project_transcription_id: row.transcriptionId
						? (projectTranscriptionIds.get(row.transcriptionId) ?? null)
						: null,
					transcription_id: row.transcriptionId,
					...witnessSourceColumns(row.source),
				},
			})),
			WITNESS_COLUMNS
		);
		const tokenKey = (witnessId: string, tokenIndex: number) => `${witnessId}\0${tokenIndex}`;
		const tokens = diffByKey(
			stored.tokens.map(({ id, ...row }) => ({
				key: tokenKey(row.witness_id, row.token_index),
				id,
				row,
			})),
			input.tokens.map(row => ({
				key: tokenKey(row.witnessId, row.tokenIndex),
				row: {
					collation_id: input.collationId,
					witness_id: row.witnessId,
					token_index: row.tokenIndex,
					token_text: row.tokenText.slice(0, 255),
				},
			})),
			['token_text']
		);

		const storedUnitKeys = occurrenceKeys(
			stored.units.map(unit => `${unit.start_index}:${unit.end_index}`)
		);
		const storedUnitKeyById = new Map(
			stored.units.map((unit, index) => [unit.id, storedUnitKeys[index]] as const)
		);
		const unitKeys = occurrenceKeys(
			input.variationUnits.map(unit => `${unit.startIndex}:${unit.endIndex}`)
		);
		const units = diffByKey(
			stored.units.map(({ id, ...row }, index) => ({ key: storedUnitKeys[index], id, row })),
			input.variationUnits.map((unit, index) => ({
				key: unitKeys[index],
				row: {
					collation_id: input.collationId,
					start_index: unit.startIndex,
					end_index: unit.endIndex,
					unit_type: unit.unitType,
					base_text: unit.baseText,
				},
			})),
			['unit_type', 'base_text']
		);

		const storedReadingKeyById = new Map<string, string>();
		const readings = diffByKey(
			stored.readings.map(({ id, ...row }) => {
				const key = `${storedUnitKeyById.get(row.variation_unit_id)}/${row.reading_order}`;
				storedReadingKeyById.set(id, key);
				return { key, id, row };
			}),
			input.variationUnits.flatMap((unit, index) =>
				unit.readings.map(reading => ({
					key: `${unitKeys[index]}/${reading.readingOrder}`,
					row: {
						variation_unit_id: units.idByKey.get(unitKeys[index])!,
						reading_order: reading.readingOrder,
						reading_text: reading.readingText,
						is_omission: reading.isOmission ? 1 : 0,
						is_lacuna: reading.isLacuna ? 1 : 0,
					},
				}))
			),
			['reading_text', 'is_omission', 'is_lacuna']
		);
		const readingWitnesses = diffByKey(
			stored.readingWitnesses.map(({ id, ...row }) => ({
				key: `${storedReadingKeyById.get(row.reading_id)}\0${row.witness_id}`,
				id,
				row,
			})),
			input.variationUnits.flatMap((unit, index) =>
				unit.readings.flatMap(reading => {
					const readingKey = `${unitKeys[index]}/${reading.readingOrder}`;
					return reading.witnessIds.map(witnessId => ({
						key: `${readingKey}\0${witnessId}`,
						row: {
							reading_id: readings.idByKey.get(readingKey)!,
							witness_id: witnessId,
						},
					}));
				})
			),
			[]
		);

		await deleteRows(trx, 'collation_reading_witnesses', readingWitnesses.deleteIds);
		await deleteRows(trx, 'collation_readings', readings.deleteIds);
		await deleteRows(trx, 'collation_variation_units', units.deleteIds);
		await deleteRows(trx, 'collation_tokens', tokens.deleteIds);
		await deleteRows(trx, 'collation_witnesses', witnesses.deleteIds);
		await upsertRows(trx, 'collation_witnesses', witnesses.upserts, WITNESS_COLUMNS);
		await upsertRows(trx, 'collation_tokens', tokens.upserts, ['token_text']);
		await upsertRows(trx, 'collation_variation_units', units.upserts, [
			'unit_type',
			'base_text',
		]);
		await upsertRows(trx, 'collation_readings', readings.upserts, [
			'reading_text',
			'is_omission',
			'is_lacuna',
		]);
		await upsertRows(trx, 'collation_reading_witnesses', readingWitnesses.upserts, []);
	};
	if ('isTransaction' in db && db.isTransaction === true) await save(db);
	else await db.transaction().execute(save);
}

type ProjectionTable =
	| 'collation_witnesses'
	| 'collation_tokens'
	| 'collation_variation_units'
	| 'collation_readings'
	| 'collation_reading_witnesses';
type ProjectionRow = Record<string, string | number | null>;

const WITNESS_COLUMNS = [
	'content',
	'position',
	'project_transcription_id',
	'transcription_id',
	'source_kind',
	'source_revision_id',
	'source_content_hash',
	'source_captured_at',
];
const ROWS_PER_STATEMENT = 500;

async function loadStoredProjection(db: DbExecutor, collationId: string) {
	const [witnesses, tokens, units, readings, readingWitnesses] = await Promise.all([
		db
			.selectFrom('collation_witnesses')
			.select(['id', 'witness_id', ...(WITNESS_COLUMNS as ['content'])])
			.where('collation_id', '=', collationId)
			.execute(),
		db
			.selectFrom('collation_tokens')
			.select(['id', 'witness_id', 'token_index', 'token_text'])
			.where('collation_id', '=', collationId)
			.execute(),
		db
			.selectFrom('collation_variation_units')
			.select(['id', 'start_index', 'end_index', 'unit_type', 'base_text'])
			.where('collation_id', '=', collationId)
			.orderBy('start_index')
			.orderBy('end_index')
			.orderBy('id')
			.execute(),
		db
			.selectFrom('collation_readings as r')
			.innerJoin('collation_variation_units as u', 'u.id', 'r.variation_unit_id')
			.select([
				'r.id',
				'r.variation_unit_id',
				'r.reading_order',
				'r.reading_text',
				'r.is_omission',
				'r.is_lacuna',
			])
			.where('u.collation_id', '=', collationId)
			.execute(),
		db
			.selectFrom('collation_reading_witnesses as rw')
			.innerJoin('collation_readings as r', 'r.id', 'rw.reading_id')
			.innerJoin('collation_variation_units as u', 'u.id', 'r.variation_unit_id')
			.select(['rw.id', 'rw.reading_id', 'rw.witness_id'])
			.where('u.collation_id', '=', collationId)
			.execute(),
	]);
	return {
		witnesses: witnesses as Array<ProjectionRow & { id: string; witness_id: string }>,
		tokens: tokens as Array<{
			id: string;
			witness_id: string;
			token_index: number;
			token_text: string;
		}>,
		units: units as Array<
			ProjectionRow & { id: string; start_index: number; end_index: number }
		>,
		readings: readings as Array<
			ProjectionRow & { id: string; variation_unit_id: string; reading_order: number }
		>,
		readingWitnesses: readingWitnesses as Array<{
			id: string;
			reading_id: string;
			witness_id: string;
		}>,
	};
}

/** Suffixes repeated keys with their occurrence, so duplicates pair up in order. */
function occurrenceKeys(keys: string[]): string[] {
	const seen = new Map<string, number>();
	return keys.map(key => {
		const occurrence = seen.get(key) ?? 0;
		seen.set(key, occurrence + 1);
		return `${key}#${occurrence}`;
	});
}

/** Pairs desired rows with stored rows by key, keeping stored ids. */
function diffByKey(
	stored: Array<{ key: string; id: string; row: ProjectionRow }>,
	desired: Array<{ key: string; row: ProjectionRow }>,
	columns: string[]
) {
	const storedByKey = new Map<string, { id: string; row: ProjectionRow }>();
	const deleteIds: string[] = [];
	for (const entry of stored) {
		if (storedByKey.has(entry.key)) deleteIds.push(entry.id);
		else storedByKey.set(entry.key, entry);
	}
	const upserts: ProjectionRow[] = [];
	const idByKey = new Map<string, string>();
	for (const { key, row } of desired) {
		const match = storedByKey.get(key);
		storedByKey.delete(key);
		const id = match?.id ?? crypto.randomUUID();
		idByKey.set(key, id);
		if (!match || columns.some(column => match.row[column] !== row[column]))
			upserts.push({ ...row, id });
	}
	for (const { id } of storedByKey.values()) deleteIds.push(id);
	return { upserts, deleteIds, idByKey };
}

async function deleteRows(db: DbExecutor, table: ProjectionTable, ids: string[]): Promise<void> {
	for (let start = 0; start < ids.length; start += ROWS_PER_STATEMENT)
		await db
			.deleteFrom(table)
			.where('id', 'in', ids.slice(start, start + ROWS_PER_STATEMENT))
			.execute();
}

async function upsertRows(
	db: DbExecutor,
	table: ProjectionTable,
	rows: ProjectionRow[],
	columns: string[]
): Promise<void> {
	const updates = Object.fromEntries(
		columns.map(column => [column, sql.ref(`excluded.${column}`)])
	);
	for (let start = 0; start < rows.length; start += ROWS_PER_STATEMENT) {
		const insert = db
			.insertInto(table)
			.values(rows.slice(start, start + ROWS_PER_STATEMENT) as any);
		await (
			columns.length
				? insert.onConflict(oc => oc.column('id').doUpdateSet(updates as any))
				: insert
		).execute();
	}
}

export async function updateCollationMetadata(
	db: DbExecutor,
	input: UpdateCollationMetadataInput
): Promise<void> {
	const update: Record<string, string | number | null> = {
		updated_at: input.updatedAt ?? new Date().toISOString(),
	};
	if (input.title !== undefined) update.title = input.title;
	if (input.verseIdentifier !== undefined) update.verse_identifier = input.verseIdentifier;
	if (input.notes !== undefined) update.notes = input.notes;
	if (input.groupPath !== undefined) update.group_path = input.groupPath;
	if (input.sortKey !== undefined) update.sort_key = input.sortKey;
	const result = await db
		.updateTable('collations')
		.set(update)
		.where('id', '=', input.id)
		.executeTakeFirst();
	if (Number(result.numUpdatedRows) === 0)
		throw new Error(`Collation ${input.id} was not found.`);
}

interface CollationWitnessSourceStatusQueryRow {
	witness_id: string;
	position: number;
	project_transcription_id: string | null;
	transcription_id: string | null;
	source_kind: string;
	source_revision_id: string;
	source_content_hash: string;
	source_captured_at: string;
}

const witnessStatusMemo = new Map<
	string,
	{ inputs: string; witnesses: CollationWitnessSourceStatus[] }
>();

/**
 * Computes witness source statuses and remembers them with their inputs. With `reuse`, returns the
 * remembered statuses while the inputs are unchanged.
 */
export async function getCollationWitnessSourceStatuses(
	db: DbExecutor,
	collationId: string,
	{ reuse = false }: { reuse?: boolean } = {}
): Promise<CollationWitnessSourceStatus[]> {
	const inputs = await loadWitnessSourceStatusInputs(db, collationId);
	const memo = witnessStatusMemo.get(collationId);
	if (reuse && memo?.inputs === inputs) return memo.witnesses;
	const witnesses = await computeCollationWitnessSourceStatuses(db, collationId);
	witnessStatusMemo.set(collationId, { inputs, witnesses });
	return witnesses;
}

// Selects everything the statuses derive from, so equal inputs always mean equal statuses.
async function loadWitnessSourceStatusInputs(db: DbExecutor, collationId: string): Promise<string> {
	const { rows } = await sql<Record<string, unknown>>`
		select
			cw.witness_id, cw.position, cw.project_transcription_id, cw.transcription_id,
			cw.source_kind, cw.source_revision_id, cw.source_content_hash, cw.source_captured_at,
			t.id as existing_transcription_id,
			pt.transcription_id as owned_transcription_id,
			(
				select content_hash from document_file_fingerprints
				where entity_type = 'transcription' and entity_id = cw.project_transcription_id
			) as content_hash,
			(
				select group_concat(id || char(31) || label || char(31) || created_at, char(30))
				from (
					select id, label, created_at from transcription_checkpoints
					where transcription_id = pt.transcription_id and is_committed = 1
					order by created_at, id
				)
			) as versions
		from collation_witnesses cw
		left join project_transcriptions pt on pt.id = cw.project_transcription_id
		left join transcriptions t on t.id = pt.transcription_id
		where cw.collation_id = ${collationId}
		order by cw.position asc, cw.id asc
	`.execute(db);
	return JSON.stringify(rows);
}

async function computeCollationWitnessSourceStatuses(
	db: DbExecutor,
	collationId: string
): Promise<CollationWitnessSourceStatus[]> {
	const rows = await db
		.selectFrom('collation_witnesses')
		.select([
			'witness_id',
			'position',
			'project_transcription_id',
			'transcription_id',
			'source_kind',
			'source_revision_id',
			'source_content_hash',
			'source_captured_at',
		])
		.where('collation_id', '=', collationId)
		.orderBy('position', 'asc')
		.orderBy('id', 'asc')
		.execute();
	const sourceStates = new Map<string, Promise<TranscriptionSourceState>>();
	const loadSourceState = (projectTranscriptionId: string) => {
		let state = sourceStates.get(projectTranscriptionId);
		if (!state) {
			state = loadTranscriptionSourceState(db, projectTranscriptionId);
			sourceStates.set(projectTranscriptionId, state);
		}
		return state;
	};
	return Promise.all(rows.map(row => mapCollationWitnessSourceStatus(db, row, loadSourceState)));
}

async function mapCollationWitnessSourceStatus(
	db: DbExecutor,
	row: CollationWitnessSourceStatusQueryRow,
	loadSourceState: (projectTranscriptionId: string) => Promise<TranscriptionSourceState>
): Promise<CollationWitnessSourceStatus> {
	const projectTranscriptionId = row.project_transcription_id;
	const source = witnessSourceFromRow(row);
	const base = {
		witnessId: row.witness_id,
		position: row.position,
		projectTranscriptionId,
		projectOwnedTranscriptionId: row.transcription_id,
		source,
		sourceVersionLabel: null,
	};

	if (!projectTranscriptionId || !source) return { ...base, versionState: 'no-source' };

	const exists = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select('project_transcriptions.id')
		.where('project_transcriptions.id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!exists) return { ...base, versionState: 'source-missing' };

	const state = await loadSourceState(projectTranscriptionId);
	return {
		...base,
		sourceVersionLabel:
			source.kind === 'version'
				? (state.versions.find(version => version.id === source.versionId)?.label ?? null)
				: null,
		versionState: deriveSourceFreshness(source, state),
	};
}

function witnessSourceFromRow(row: CollationWitnessSourceStatusQueryRow): WitnessSource | null {
	if (!row.transcription_id) return null;
	if (row.source_kind === 'version') {
		return {
			kind: 'version',
			transcriptionId: row.transcription_id,
			versionId: row.source_revision_id,
		};
	}
	if (row.source_kind === 'current') {
		return {
			kind: 'current',
			transcriptionId: row.transcription_id,
			capturedAt: row.source_captured_at,
			contentHash: row.source_content_hash,
		};
	}
	return null;
}

async function loadWitnessProjectTranscriptionIds(
	db: DbExecutor,
	projectId: string,
	witnesses: SaveCollationProjectionWitnessInput[]
): Promise<Map<string, string>> {
	const transcriptionIds = [
		...new Set(witnesses.map(row => row.transcriptionId).filter(isNonEmptyString)),
	];
	if (transcriptionIds.length === 0) return new Map();

	const transcriptionRows = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select([
			'transcriptions.id as id',
			'project_transcriptions.id as project_transcription_id',
		])
		.where('project_transcriptions.project_id', '=', projectId)
		.where('transcriptions.id', 'in', transcriptionIds)
		.execute();
	const projectTranscriptionIds = new Map(
		transcriptionRows.map(
			row =>
				[
					requireId(row.id, 'transcription'),
					requireId(row.project_transcription_id, 'project transcription'),
				] as const
		)
	);
	for (const witness of witnesses) {
		if (!witness.transcriptionId) continue;
		const projectTranscriptionId = projectTranscriptionIds.get(witness.transcriptionId);
		if (!projectTranscriptionId) {
			throw new Error(
				`Witness transcription ${witness.transcriptionId} does not belong to collation project ${projectId}.`
			);
		}
		if (
			witness.projectTranscriptionId &&
			witness.projectTranscriptionId !== projectTranscriptionId
		) {
			throw new Error(
				`Project transcription ${witness.projectTranscriptionId} does not match transcription ${witness.transcriptionId}.`
			);
		}
	}
	return projectTranscriptionIds;
}

function isNonEmptyString(value: string | null): value is string {
	return typeof value === 'string' && value.length > 0;
}
