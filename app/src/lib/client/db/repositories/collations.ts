import type { Kysely, Selectable, Transaction } from 'kysely';

import type { Collations, Database } from '../types.generated';
import {
	deriveEntityCloudBackupState,
	type EntityCloudBackupState,
	type SyncProjectContext,
} from '$lib/client/sync/backup-status';
import {
	getCollationCheckpointStatus,
	getProjectTranscriptionCheckpointStatus,
	type EntityCheckpointHead,
	type EntityCommitState,
} from './revisions';

type DbExecutor = Kysely<Database> | Transaction<Database>;

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
	now?: string;
}

export interface UpdateCollationMetadataInput {
	id: string;
	title?: string;
	projectId?: string | null;
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

export interface CollationRecord {
	id: string;
	projectId: string | null;
	title: string;
	verseIdentifier: string;
	status: string;
	groupPath: string;
	notes: string;
	sortKey: number;
	createdAt: string;
	updatedAt: string;
}

export interface CollationProjectionRecord {
	witnesses: Array<{
		witnessId: string;
		transcriptionId: string | null;
		sourceVersion: string;
		content: string;
		position: number;
	}>;
	tokens: Array<{ witnessId: string; tokenIndex: number; tokenText: string }>;
	variationUnits: Array<{
		id: string;
		startIndex: number;
		endIndex: number;
		unitType: string;
		baseText: string;
		readings: Array<{
			id: string;
			readingOrder: number;
			readingText: string;
			isOmission: boolean;
			isLacuna: boolean;
			witnessIds: string[];
		}>;
	}>;
}

export type CollationWitnessVersionState =
	| 'no-source'
	| 'source-missing'
	| 'source-has-no-committed-version'
	| 'pinned-current'
	| 'newer-source-available'
	| 'source-has-uncommitted-changes';

export interface CollationWitnessSourceStatus {
	witnessId: string;
	position: number;
	projectTranscriptionId: string | null;
	projectOwnedTranscriptionId: string | null;
	pinnedCheckpoint: EntityCheckpointHead | null;
	availableCheckpoint: EntityCheckpointHead | null;
	sourceDirtyToCheckpoint: boolean | null;
	versionState: CollationWitnessVersionState;
}

export interface CollationVersionStatus {
	projectId: string | null;
	projectName: string | null;
	collationId: string;
	title: string;
	verseIdentifier: string;
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

export interface SaveCollationProjectionWitnessInput {
	witnessId: string;
	transcriptionId: string | null;
	projectTranscriptionId?: string | null;
	sourceVersion: string;
	sourceContentHash?: string;
	content: string;
	position: number;
}

export interface LoadedCollation {
	row: CollationRecord;
	artifact: CollationArtifactRecord | null;
	legacyArtifact: CollationArtifactRecord | null;
	projection: CollationProjectionRecord;
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
	tokens: CollationProjectionRecord['tokens'];
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

export async function listProjectCollationVersionStatuses(
	db: DbExecutor,
	projectId: string,
	options: CollationVersionStatusOptions = {}
): Promise<CollationVersionStatus[]> {
	const rows = await db
		.selectFrom('collations')
		.select('id')
		.where('project_id', '=', projectId)
		.orderBy('updated_at', 'desc')
		.execute();
	return Promise.all(
		rows.map(row => getCollationVersionStatus(db, requireId(row.id, 'collation'), options))
	);
}

export async function getCollationVersionStatus(
	db: DbExecutor,
	collationId: string,
	options: CollationVersionStatusOptions = {}
): Promise<CollationVersionStatus> {
	const row = await db
		.selectFrom('collations')
		.leftJoin('projects', 'projects.id', 'collations.project_id')
		.select([
			'collations.id as id',
			'collations.project_id as project_id',
			'projects.name as project_name',
			'collations.title as title',
			'collations.verse_identifier as verse_identifier',
			'collations.status as status',
		])
		.where('collations.id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);

	const id = requireId(row.id, 'collation');
	const checkpointStatus = await getCollationCheckpointStatus(db, id);
	const cloudBackupState = await deriveEntityCloudBackupState(
		db,
		options.syncContext,
		{ entityType: 'collation', entityId: id },
		checkpointStatus.currentCheckpoint,
		checkpointStatus.dirtyToCheckpoint
	);
	return {
		projectId: row.project_id,
		projectName: row.project_name,
		collationId: id,
		title: row.title,
		verseIdentifier: row.verse_identifier,
		workflowStatus: row.status,
		currentCheckpoint: checkpointStatus.currentCheckpoint,
		workingContentHash: checkpointStatus.workingContentHash,
		dirtyToCheckpoint: checkpointStatus.dirtyToCheckpoint,
		commitState: checkpointStatus.commitState,
		witnesses: await getCollationWitnessSourceStatuses(db, id),
		cloudBackupState,
	};
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
			created_at: now,
			updated_at: now,
		})
		.execute();
	return id;
}

export async function loadCollation(
	db: DbExecutor,
	collationId: string
): Promise<LoadedCollation | null> {
	const row = await db
		.selectFrom('collations')
		.selectAll()
		.where('id', '=', collationId)
		.executeTakeFirst();
	if (!row) return null;
	const artifacts = await db
		.selectFrom('collation_artifacts')
		.selectAll()
		.where('collation_id', '=', collationId)
		.execute();
	return {
		row: mapCollationRecord(row),
		artifact: mapArtifact(
			artifacts.find(artifact => artifact.artifact_type === 'collation_document_v1')
		),
		legacyArtifact:
			mapArtifact(
				artifacts.find(artifact => artifact.artifact_type === 'workspace_state_v2')
			) ??
			mapArtifact(
				artifacts.find(artifact => artifact.artifact_type === 'workspace_state_v1')
			),
		projection: await loadProjection(db, collationId),
	};
}

export async function saveCollationArtifact(
	db: DbExecutor,
	input: SaveCollationArtifactInput
): Promise<string> {
	// Phase 5 transition: DB-worker autosave writes collation working files instead.
	// This remains only for legacy import/sync callers until Phase 6 removes artifact storage.
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
	db: Kysely<Database>,
	input: SaveCollationProjectionInput
): Promise<void> {
	await db.transaction().execute(async trx => {
		const collation = await trx
			.selectFrom('collations')
			.select(['project_id'])
			.where('id', '=', input.collationId)
			.executeTakeFirst();
		if (!collation) throw new Error(`Collation ${input.collationId} was not found.`);
		const sourceMetadataByTranscriptionId = await loadWitnessSourceMetadata(
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
						...sourceMetadataForWitness(row, sourceMetadataByTranscriptionId),
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
	});
}

export async function updateCollationMetadata(
	db: DbExecutor,
	input: UpdateCollationMetadataInput
): Promise<void> {
	const update: Record<string, string | number | null> = {
		updated_at: input.updatedAt ?? new Date().toISOString(),
	};
	if (input.title !== undefined) update.title = input.title;
	if (input.projectId !== undefined) update.project_id = input.projectId;
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

export function mapCollationRow(row: Selectable<Collations>): CollationListItem {
	return {
		id: requireId(row.id, 'collation'),
		projectId: requireId(row.project_id, 'collation project'),
		projectName: 'Project',
		title: row.title,
		verseIdentifier: row.verse_identifier,
		status: row.status,
		updatedAt: row.updated_at,
	};
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} id`);
	return value;
}

interface WitnessSourceMetadata {
	projectTranscriptionId: string | null;
	revisionId: string;
	contentHash: string;
}

interface CollationWitnessSourceStatusQueryRow {
	witness_id: string;
	position: number;
	project_transcription_id: string | null;
	transcription_id: string | null;
	source_revision_id: string;
	source_content_hash: string;
}

interface WitnessAvailableSourceStatus {
	projectOwnedTranscriptionId: string;
	currentCheckpoint: EntityCheckpointHead | null;
	dirtyToCheckpoint: boolean;
}

async function getCollationWitnessSourceStatuses(
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
			'source_revision_id',
			'source_content_hash',
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
	const pinnedCheckpoint = checkpointHeadFromFields(
		row.source_revision_id,
		row.source_content_hash
	);
	const base = {
		witnessId: row.witness_id,
		position: row.position,
		projectTranscriptionId,
		projectOwnedTranscriptionId: row.transcription_id,
		pinnedCheckpoint,
	};

	if (!projectTranscriptionId) {
		return {
			...base,
			availableCheckpoint: null,
			sourceDirtyToCheckpoint: null,
			versionState: 'no-source',
		};
	}

	const sourceStatus = await loadWitnessAvailableSourceStatus(db, projectTranscriptionId);
	if (!sourceStatus) {
		return {
			...base,
			availableCheckpoint: null,
			sourceDirtyToCheckpoint: null,
			versionState: 'source-missing',
		};
	}

	return {
		...base,
		projectOwnedTranscriptionId: sourceStatus.projectOwnedTranscriptionId,
		availableCheckpoint: sourceStatus.currentCheckpoint,
		sourceDirtyToCheckpoint: sourceStatus.dirtyToCheckpoint,
		versionState: deriveCollationWitnessVersionState({
			pinnedCheckpoint,
			availableCheckpoint: sourceStatus.currentCheckpoint,
			sourceDirtyToCheckpoint: sourceStatus.dirtyToCheckpoint,
		}),
	};
}

async function loadWitnessAvailableSourceStatus(
	db: DbExecutor,
	projectTranscriptionId: string
): Promise<WitnessAvailableSourceStatus | null> {
	const row = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select('project_transcriptions.transcription_id as transcription_id')
		.where('project_transcriptions.id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!row) return null;

	const checkpointStatus = await getProjectTranscriptionCheckpointStatus(
		db,
		projectTranscriptionId
	);
	return {
		projectOwnedTranscriptionId: requireId(row.transcription_id, 'project-owned transcription'),
		currentCheckpoint: checkpointStatus.currentCheckpoint,
		dirtyToCheckpoint: checkpointStatus.dirtyToCheckpoint,
	};
}

function deriveCollationWitnessVersionState(input: {
	pinnedCheckpoint: EntityCheckpointHead | null;
	availableCheckpoint: EntityCheckpointHead | null;
	sourceDirtyToCheckpoint: boolean;
}): CollationWitnessVersionState {
	if (!input.availableCheckpoint) return 'source-has-no-committed-version';
	if (input.sourceDirtyToCheckpoint) return 'source-has-uncommitted-changes';
	if (areSameCheckpoint(input.pinnedCheckpoint, input.availableCheckpoint))
		return 'pinned-current';
	return 'newer-source-available';
}

function areSameCheckpoint(
	left: EntityCheckpointHead | null,
	right: EntityCheckpointHead | null
): boolean {
	return Boolean(
		left &&
		right &&
		left.revisionId === right.revisionId &&
		left.contentHash === right.contentHash
	);
}

function checkpointHeadFromFields(
	revisionId: string | null,
	contentHash: string | null
): EntityCheckpointHead | null {
	if (!revisionId || !contentHash) return null;
	return { revisionId, contentHash };
}

async function loadWitnessSourceMetadata(
	db: DbExecutor,
	projectId: string | null,
	witnesses: SaveCollationProjectionWitnessInput[]
): Promise<Map<string, WitnessSourceMetadata>> {
	const transcriptionIds = [
		...new Set(witnesses.map(row => row.transcriptionId).filter(isNonEmptyString)),
	];
	if (transcriptionIds.length === 0) return new Map();

	const transcriptionRows = await db
		.selectFrom('transcriptions')
		.select(['id', 'current_revision_id', 'current_content_hash'])
		.where('id', 'in', transcriptionIds)
		.execute();
	const projectTranscriptionRows = projectId
		? await db
				.selectFrom('project_transcriptions')
				.select(['id', 'transcription_id'])
				.where('project_id', '=', projectId)
				.where('transcription_id', 'in', transcriptionIds)
				.execute()
		: [];
	const projectTranscriptionIdByTranscriptionId = new Map(
		projectTranscriptionRows.map(row => [
			row.transcription_id,
			requireId(row.id, 'project transcription'),
		])
	);

	return new Map(
		transcriptionRows.map(row => {
			const transcriptionId = requireId(row.id, 'transcription');
			return [
				transcriptionId,
				{
					projectTranscriptionId:
						projectTranscriptionIdByTranscriptionId.get(transcriptionId) ?? null,
					revisionId: row.current_revision_id,
					contentHash: row.current_content_hash,
				},
			] as const;
		})
	);
}

function sourceMetadataForWitness(
	witness: SaveCollationProjectionWitnessInput,
	sourceMetadataByTranscriptionId: Map<string, WitnessSourceMetadata>
): Pick<
	Selectable<Database['collation_witnesses']>,
	'project_transcription_id' | 'transcription_id' | 'source_revision_id' | 'source_content_hash'
> {
	const source = witness.transcriptionId
		? sourceMetadataByTranscriptionId.get(witness.transcriptionId)
		: undefined;
	const explicitPinnedSource = Boolean(witness.sourceVersion && witness.sourceContentHash);
	return {
		project_transcription_id:
			witness.projectTranscriptionId ?? source?.projectTranscriptionId ?? null,
		transcription_id: witness.transcriptionId,
		source_revision_id: explicitPinnedSource
			? witness.sourceVersion
			: (source?.revisionId ?? witness.sourceVersion),
		source_content_hash: explicitPinnedSource
			? (witness.sourceContentHash ?? '')
			: (source?.contentHash ?? witness.sourceContentHash ?? ''),
	};
}

function isNonEmptyString(value: string | null): value is string {
	return typeof value === 'string' && value.length > 0;
}

async function loadProjection(
	db: DbExecutor,
	collationId: string
): Promise<CollationProjectionRecord> {
	const [witnesses, tokens, units, readings, readingWitnesses] = await Promise.all([
		db
			.selectFrom('collation_witnesses')
			.selectAll()
			.where('collation_id', '=', collationId)
			.orderBy('position', 'asc')
			.execute(),
		db
			.selectFrom('collation_tokens')
			.selectAll()
			.where('collation_id', '=', collationId)
			.orderBy('token_index', 'asc')
			.execute(),
		db
			.selectFrom('collation_variation_units')
			.selectAll()
			.where('collation_id', '=', collationId)
			.orderBy('start_index', 'asc')
			.execute(),
		db
			.selectFrom('collation_readings')
			.innerJoin(
				'collation_variation_units',
				'collation_variation_units.id',
				'collation_readings.variation_unit_id'
			)
			.select([
				'collation_readings.id as id',
				'collation_readings.variation_unit_id as variation_unit_id',
				'collation_readings.reading_order as reading_order',
				'collation_readings.reading_text as reading_text',
				'collation_readings.is_omission as is_omission',
				'collation_readings.is_lacuna as is_lacuna',
			])
			.where('collation_variation_units.collation_id', '=', collationId)
			.orderBy('collation_readings.reading_order', 'asc')
			.execute(),
		db
			.selectFrom('collation_reading_witnesses')
			.innerJoin(
				'collation_readings',
				'collation_readings.id',
				'collation_reading_witnesses.reading_id'
			)
			.innerJoin(
				'collation_variation_units',
				'collation_variation_units.id',
				'collation_readings.variation_unit_id'
			)
			.select([
				'collation_reading_witnesses.reading_id as reading_id',
				'collation_reading_witnesses.witness_id as witness_id',
			])
			.where('collation_variation_units.collation_id', '=', collationId)
			.execute(),
	]);

	const witnessesByReadingId = new Map<string, string[]>();
	for (const row of readingWitnesses) {
		const values = witnessesByReadingId.get(row.reading_id) ?? [];
		values.push(row.witness_id);
		witnessesByReadingId.set(row.reading_id, values);
	}
	const readingsByUnitId = new Map<string, typeof readings>();
	for (const row of readings) {
		const values = readingsByUnitId.get(row.variation_unit_id) ?? [];
		values.push(row);
		readingsByUnitId.set(row.variation_unit_id, values);
	}

	return {
		witnesses: witnesses.map(row => ({
			witnessId: row.witness_id,
			transcriptionId: row.transcription_id,
			sourceVersion: row.source_revision_id,
			content: row.content,
			position: row.position,
		})),
		tokens: tokens.map(row => ({
			witnessId: row.witness_id,
			tokenIndex: row.token_index,
			tokenText: row.token_text,
		})),
		variationUnits: units.map(unit => ({
			id: requireId(unit.id, 'variation unit'),
			startIndex: unit.start_index,
			endIndex: unit.end_index,
			unitType: unit.unit_type,
			baseText: unit.base_text,
			readings: (readingsByUnitId.get(requireId(unit.id, 'variation unit')) ?? []).map(
				reading => ({
					id: requireId(reading.id, 'reading'),
					readingOrder: reading.reading_order,
					readingText: reading.reading_text,
					isOmission: Boolean(reading.is_omission),
					isLacuna: Boolean(reading.is_lacuna),
					witnessIds: witnessesByReadingId.get(requireId(reading.id, 'reading')) ?? [],
				})
			),
		})),
	};
}

function mapArtifact(
	row: Selectable<Database['collation_artifacts']> | undefined
): CollationArtifactRecord | null {
	if (!row) return null;
	return {
		id: requireId(row.id, 'artifact'),
		artifactType: row.artifact_type,
		payload: row.payload,
		createdAt: row.created_at,
	};
}

function mapCollationRecord(row: Selectable<Collations>): CollationRecord {
	return {
		id: requireId(row.id, 'collation'),
		projectId: row.project_id,
		title: row.title,
		verseIdentifier: row.verse_identifier,
		status: row.status,
		groupPath: row.group_path,
		notes: row.notes,
		sortKey: row.sort_key,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
