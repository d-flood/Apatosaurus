import type { CollationSegment } from '$lib/collation/collation-document';
import { witnessSourceColumns } from '$lib/collation/collation-projection';
import type { WitnessSource } from '$lib/collation/collation-types';
import { type EntityCloudBackupState, type SyncProjectContext } from '$lib/backup/backup-status';
import {
	deriveSourceFreshness,
	loadTranscriptionSourceState,
	type EntityCheckpointHead,
	type EntityCommitState,
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
	status?: string;
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
	workflowStatus: string;
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
			status: 'setup',
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

		await trx
			.deleteFrom('collation_witnesses')
			.where('collation_id', '=', input.collationId)
			.execute();
		await trx
			.deleteFrom('collation_tokens')
			.where('collation_id', '=', input.collationId)
			.execute();
		await trx
			.deleteFrom('collation_variation_units')
			.where('collation_id', '=', input.collationId)
			.execute();

		if (input.witnesses.length > 0) {
			await trx
				.insertInto('collation_witnesses')
				.values(
					input.witnesses.map(row => ({
						project_transcription_id: row.transcriptionId
							? (projectTranscriptionIds.get(row.transcriptionId) ?? null)
							: null,
						transcription_id: row.transcriptionId,
						...witnessSourceColumns(row.source),
						id: crypto.randomUUID(),
						collation_id: input.collationId,
						witness_id: row.witnessId,
						content: row.content,
						position: row.position,
					}))
				)
				.execute();
		}

		if (input.tokens.length > 0) {
			await trx
				.insertInto('collation_tokens')
				.values(
					input.tokens.map(row => ({
						id: crypto.randomUUID(),
						collation_id: input.collationId,
						witness_id: row.witnessId,
						token_index: row.tokenIndex,
						token_text: row.tokenText.slice(0, 255),
					}))
				)
				.execute();
		}

		for (const unit of input.variationUnits) {
			const variationUnitId = crypto.randomUUID();
			await trx
				.insertInto('collation_variation_units')
				.values({
					id: variationUnitId,
					collation_id: input.collationId,
					start_index: unit.startIndex,
					end_index: unit.endIndex,
					unit_type: unit.unitType,
					base_text: unit.baseText,
				})
				.execute();

			for (const reading of unit.readings) {
				const readingId = crypto.randomUUID();
				await trx
					.insertInto('collation_readings')
					.values({
						id: readingId,
						variation_unit_id: variationUnitId,
						reading_order: reading.readingOrder,
						reading_text: reading.readingText,
						is_omission: reading.isOmission ? 1 : 0,
						is_lacuna: reading.isLacuna ? 1 : 0,
					})
					.execute();

				if (reading.witnessIds.length > 0) {
					await trx
						.insertInto('collation_reading_witnesses')
						.values(
							reading.witnessIds.map(witnessId => ({
								id: crypto.randomUUID(),
								reading_id: readingId,
								witness_id: witnessId,
							}))
						)
						.execute();
				}
			}
		}
	};
	if ('isTransaction' in db && db.isTransaction === true) await save(db);
	else await db.transaction().execute(save);
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
	if (input.status !== undefined) update.status = input.status;
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

export async function getCollationWitnessSourceStatuses(
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
	return Promise.all(rows.map(row => mapCollationWitnessSourceStatus(db, row)));
}

async function mapCollationWitnessSourceStatus(
	db: DbExecutor,
	row: CollationWitnessSourceStatusQueryRow
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

	const state = await loadTranscriptionSourceState(db, projectTranscriptionId);
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
