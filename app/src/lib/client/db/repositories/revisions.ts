import { nanoid } from 'nanoid';
import type { Kysely, Selectable, Transaction } from 'kysely';

import { canonicalJson, hashCanonicalPayload } from '$lib/client/sync/canonical-json';
import type { CollationCheckpoints, Database, TranscriptionCheckpoints } from '../types.generated';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface ProjectTranscriptionSnapshot {
	project_transcription_id: string;
	id: string;
	format: string;
	title: string;
	siglum: string;
	description: string;
	content_json: unknown;
	owner: string | null;
	is_public: boolean;
	tags: string[];
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
	iiif_manifest_sources: SerializedIiifManifestSource[];
	page_canvas_links: SerializedTranscriptionPageCanvasLink[];
	canvas_annotations: SerializedIiifCanvasAnnotation[];
}

export interface SerializedIiifManifestSource {
	id: string;
	manifest_url: string;
	label: string;
	source_kind: string;
	default_canvas_id: string | null;
	default_image_service_url: string | null;
	metadata_json: unknown;
}

export interface SerializedTranscriptionPageCanvasLink {
	id: string;
	page_id: string;
	page_name_snapshot: string;
	page_order: number;
	manifest_source_id: string;
	manifest_url_snapshot: string;
	canvas_id: string;
	canvas_order: number;
	canvas_label: string;
	image_service_url: string | null;
	thumbnail_url: string | null;
	link_role: string;
}

export interface SerializedIiifCanvasAnnotation {
	id: string;
	manifest_source_id: string;
	canvas_id: string;
	page_id: string | null;
	annotation_id: string;
	annotation_kind: string | null;
	body_json: unknown;
	target_json: unknown;
	anchor_json: unknown;
	motivation: string;
	created_by: string | null;
}

export interface SerializedCollation {
	id: string;
	project_id: string | null;
	title: string;
	verse_identifier: string;
	status: string;
	group_path: string;
	notes: string;
	sort_key: number;
	witnesses: SerializedCollationWitness[];
	tokens: SerializedCollationToken[];
	variation_units: SerializedCollationVariationUnit[];
	readings: SerializedCollationReading[];
	reading_witnesses: SerializedCollationReadingWitness[];
	artifacts: SerializedCollationArtifact[];
}

export interface SerializedCollationWitness {
	id: string;
	witness_id: string;
	content: string;
	position: number;
	project_transcription_id: string | null;
	transcription_id: string | null;
	source_revision_id: string;
	source_content_hash: string;
}

export interface SerializedCollationToken {
	id: string;
	witness_id: string;
	token_index: number;
	token_text: string;
}

export interface SerializedCollationVariationUnit {
	id: string;
	start_index: number;
	end_index: number;
	unit_type: string;
	base_text: string;
}

export interface SerializedCollationReading {
	id: string;
	variation_unit_id: string;
	reading_order: number;
	reading_text: string;
	is_lacuna: boolean;
	is_omission: boolean;
}

export interface SerializedCollationReadingWitness {
	reading_id: string;
	witness_id: string;
}

export interface SerializedCollationArtifact {
	id: string;
	artifact_type: string;
	payload: unknown;
}

export interface CommitTranscriptionInput {
	projectTranscriptionId: string;
	checkpointId?: string;
	commitMessage?: string | null;
	authorName?: string;
	createdAt?: string;
}

export interface CommitCollationInput {
	collationId: string;
	checkpointId?: string;
	commitMessage?: string | null;
	authorName?: string;
	createdAt?: string;
}

export interface Checkpoint {
	id: string;
	parentCheckpointId: string | null;
	payload: unknown;
	contentHash: string;
	isCommitted: boolean;
	commitMessage: string | null;
	authorName: string;
	createdAt: string;
}

export interface EntityCheckpointHead {
	revisionId: string;
	contentHash: string;
}

export type EntityCommitState = 'never-committed' | 'clean' | 'dirty';

export interface EntityCheckpointStatus {
	currentCheckpoint: EntityCheckpointHead | null;
	workingContentHash: string;
	dirtyToCheckpoint: boolean;
	commitState: EntityCommitState;
}

export interface ProjectTranscriptionCheckpointStatus extends EntityCheckpointStatus {
	projectTranscriptionId: string;
	projectOwnedTranscriptionId: string;
}

export interface CollationCheckpointStatus extends EntityCheckpointStatus {
	collationId: string;
}

export interface TranscriptionCheckpoint extends Checkpoint {
	projectTranscriptionId: string;
	transcriptionId: string;
	format: string;
}

export interface CollationCheckpoint extends Checkpoint {
	collationId: string;
}

export { canonicalJson, hashCanonicalPayload };

export function buildTranscriptionHashPayload(input: ProjectTranscriptionSnapshot): unknown {
	return {
		project_transcription_id: input.project_transcription_id,
		id: input.id,
		format: input.format,
		title: input.title,
		siglum: input.siglum,
		description: input.description,
		content_json: input.content_json,
		owner: input.owner,
		is_public: input.is_public === true,
		tags: [...input.tags],
		transcriber: input.transcriber,
		repository: input.repository,
		settlement: input.settlement,
		language: input.language,
		iiif_manifest_sources: [...input.iiif_manifest_sources].sort(compareById).map(row => ({
			id: row.id,
			manifest_url: row.manifest_url,
			label: row.label,
			source_kind: row.source_kind,
			default_canvas_id: row.default_canvas_id,
			default_image_service_url: row.default_image_service_url,
			metadata_json: row.metadata_json,
		})),
		page_canvas_links: [...input.page_canvas_links].sort(comparePageCanvasLinks).map(row => ({
			id: row.id,
			page_id: row.page_id,
			page_name_snapshot: row.page_name_snapshot,
			page_order: row.page_order,
			manifest_source_id: row.manifest_source_id,
			manifest_url_snapshot: row.manifest_url_snapshot,
			canvas_id: row.canvas_id,
			canvas_order: row.canvas_order,
			canvas_label: row.canvas_label,
			image_service_url: row.image_service_url,
			thumbnail_url: row.thumbnail_url,
			link_role: row.link_role,
		})),
		canvas_annotations: [...input.canvas_annotations]
			.sort(compareCanvasAnnotations)
			.map(row => ({
				id: row.id,
				manifest_source_id: row.manifest_source_id,
				canvas_id: row.canvas_id,
				page_id: row.page_id,
				annotation_id: row.annotation_id,
				annotation_kind: row.annotation_kind,
				body_json: row.body_json,
				target_json: row.target_json,
				anchor_json: row.anchor_json,
				motivation: row.motivation,
				created_by: row.created_by,
			})),
	};
}

export function buildCollationHashPayload(input: SerializedCollation): unknown {
	const readingsByUnitId = groupBy(input.readings, reading => reading.variation_unit_id);
	const witnessIdsByReadingId = groupBy(input.reading_witnesses, row => row.reading_id);
	return {
		id: input.id,
		project_id: input.project_id,
		title: input.title,
		verse_identifier: input.verse_identifier,
		status: input.status,
		group_path: input.group_path,
		notes: input.notes,
		sort_key: input.sort_key,
		witnesses: [...input.witnesses].sort(compareCollationWitnesses).map(row => ({
			witness_id: row.witness_id,
			content: row.content,
			position: row.position,
			project_transcription_id: row.project_transcription_id,
			transcription_id: row.transcription_id,
			source_revision_id: row.source_revision_id,
			source_content_hash: row.source_content_hash,
		})),
		tokens: [...input.tokens].sort(compareCollationTokens).map(row => ({
			witness_id: row.witness_id,
			token_index: row.token_index,
			token_text: row.token_text,
		})),
		variation_units: [...input.variation_units].sort(compareVariationUnits).map(unit => ({
			start_index: unit.start_index,
			end_index: unit.end_index,
			unit_type: unit.unit_type,
			base_text: unit.base_text,
			readings: [...(readingsByUnitId.get(unit.id) ?? [])]
				.sort(compareCollationReadings)
				.map(reading => ({
					reading_order: reading.reading_order,
					reading_text: reading.reading_text,
					is_lacuna: reading.is_lacuna === true,
					is_omission: reading.is_omission === true,
					witness_ids: [...(witnessIdsByReadingId.get(reading.id) ?? [])]
						.map(row => row.witness_id)
						.sort(compareStrings),
				})),
		})),
		artifacts: [...input.artifacts].sort(compareCollationArtifacts).map(row => ({
			artifact_type: row.artifact_type,
			payload: row.payload,
		})),
	};
}

export async function loadProjectTranscriptionSnapshot(
	db: DbExecutor,
	projectTranscriptionId: string
): Promise<ProjectTranscriptionSnapshot> {
	const row = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select([
			'project_transcriptions.id as project_transcription_id',
			'transcriptions.id as id',
			'transcriptions.format as format',
			'transcriptions.title as title',
			'transcriptions.siglum as siglum',
			'transcriptions.description as description',
			'transcriptions.content_json as content_json',
			'transcriptions.owner as owner',
			'transcriptions.is_public as is_public',
			'transcriptions.tags as tags',
			'transcriptions.transcriber as transcriber',
			'transcriptions.repository as repository',
			'transcriptions.settlement as settlement',
			'transcriptions.language as language',
		])
		.where('project_transcriptions.id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Project transcription ${projectTranscriptionId} was not found.`);

	const transcriptionId = requireId(row.id, 'transcription');
	return {
		project_transcription_id: requireId(row.project_transcription_id, 'project transcription'),
		id: transcriptionId,
		format: row.format,
		title: row.title,
		siglum: row.siglum,
		description: row.description,
		content_json: parseJson(
			row.content_json,
			`transcriptions.content_json for ${transcriptionId}`
		),
		owner: row.owner,
		is_public: row.is_public === 1,
		tags: parseStringArray(row.tags, `transcriptions.tags for ${transcriptionId}`),
		transcriber: row.transcriber,
		repository: row.repository,
		settlement: row.settlement,
		language: row.language,
		iiif_manifest_sources: await loadManifestSources(db, transcriptionId),
		page_canvas_links: await loadPageCanvasLinks(db, transcriptionId),
		canvas_annotations: await loadCanvasAnnotations(db, transcriptionId),
	};
}

export async function loadSerializedCollation(
	db: DbExecutor,
	collationId: string
): Promise<SerializedCollation> {
	const row = await db
		.selectFrom('collations')
		.selectAll()
		.where('id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);
	const id = requireId(row.id, 'collation');
	return {
		id,
		project_id: row.project_id,
		title: row.title,
		verse_identifier: row.verse_identifier,
		status: row.status,
		group_path: row.group_path,
		notes: row.notes,
		sort_key: row.sort_key,
		witnesses: await loadCollationWitnesses(db, id),
		tokens: await loadCollationTokens(db, id),
		variation_units: await loadCollationVariationUnits(db, id),
		readings: await loadCollationReadings(db, id),
		reading_witnesses: await loadCollationReadingWitnesses(db, id),
		artifacts: await loadCollationArtifacts(db, id),
	};
}

export async function createCommittedTranscriptionCheckpoint(
	db: Kysely<Database>,
	input: CommitTranscriptionInput
): Promise<TranscriptionCheckpoint> {
	return db.transaction().execute(async trx => {
		const snapshot = await loadProjectTranscriptionSnapshot(trx, input.projectTranscriptionId);
		const head = await trx
			.selectFrom('transcriptions')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', snapshot.id)
			.executeTakeFirstOrThrow();
		const payload = buildTranscriptionHashPayload(snapshot);
		const contentHash = await hashCanonicalPayload(payload);
		const checkpoint = buildTranscriptionCheckpointRow(
			snapshot,
			head.current_revision_id || null,
			payload,
			contentHash,
			input
		);

		await trx.insertInto('transcription_checkpoints').values(checkpoint).execute();
		await trx
			.updateTable('transcriptions')
			.set({
				current_revision_id: requireId(checkpoint.id, 'transcription checkpoint'),
				current_content_hash: contentHash,
			})
			.where('id', '=', snapshot.id)
			.execute();

		return mapTranscriptionCheckpoint(checkpoint, input.projectTranscriptionId, payload);
	});
}

export async function createCommittedCollationCheckpoint(
	db: Kysely<Database>,
	input: CommitCollationInput
): Promise<CollationCheckpoint> {
	return db.transaction().execute(async trx => {
		const collation = await loadSerializedCollation(trx, input.collationId);
		const head = await trx
			.selectFrom('collations')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', collation.id)
			.executeTakeFirstOrThrow();
		const payload = buildCollationHashPayload(collation);
		const contentHash = await hashCanonicalPayload(payload);
		const checkpoint = buildCollationCheckpointRow(
			collation.id,
			head.current_revision_id || null,
			payload,
			contentHash,
			input
		);

		await trx.insertInto('collation_checkpoints').values(checkpoint).execute();
		await trx
			.updateTable('collations')
			.set({
				current_revision_id: requireId(checkpoint.id, 'collation checkpoint'),
				current_content_hash: contentHash,
			})
			.where('id', '=', collation.id)
			.execute();

		return mapCollationCheckpoint(checkpoint, payload);
	});
}

export async function isTranscriptionDirty(
	db: DbExecutor,
	projectTranscriptionId: string
): Promise<boolean> {
	return (await getProjectTranscriptionCheckpointStatus(db, projectTranscriptionId))
		.dirtyToCheckpoint;
}

export async function isCollationDirty(db: DbExecutor, collationId: string): Promise<boolean> {
	return (await getCollationCheckpointStatus(db, collationId)).dirtyToCheckpoint;
}

export async function getProjectTranscriptionCheckpointStatus(
	db: DbExecutor,
	projectTranscriptionId: string
): Promise<ProjectTranscriptionCheckpointStatus> {
	const snapshot = await loadProjectTranscriptionSnapshot(db, projectTranscriptionId);
	const currentCheckpoint = await getTranscriptionCommittedHead(db, snapshot.id);
	const workingContentHash = await hashCanonicalPayload(buildTranscriptionHashPayload(snapshot));
	return {
		projectTranscriptionId,
		projectOwnedTranscriptionId: snapshot.id,
		...deriveCheckpointStatus(currentCheckpoint, workingContentHash),
	};
}

export async function getCollationCheckpointStatus(
	db: DbExecutor,
	collationId: string
): Promise<CollationCheckpointStatus> {
	const collation = await loadSerializedCollation(db, collationId);
	const currentCheckpoint = await getCollationCommittedHead(db, collation.id);
	const workingContentHash = await hashCanonicalPayload(buildCollationHashPayload(collation));
	return {
		collationId: collation.id,
		...deriveCheckpointStatus(currentCheckpoint, workingContentHash),
	};
}

export async function getTranscriptionCommittedHead(
	db: DbExecutor,
	transcriptionId: string
): Promise<EntityCheckpointHead | null> {
	const row = await db
		.selectFrom('transcriptions')
		.select(['current_revision_id', 'current_content_hash'])
		.where('id', '=', transcriptionId)
		.executeTakeFirst();
	if (!row?.current_revision_id || !row.current_content_hash) return null;
	return { revisionId: row.current_revision_id, contentHash: row.current_content_hash };
}

export async function getCollationCommittedHead(
	db: DbExecutor,
	collationId: string
): Promise<EntityCheckpointHead | null> {
	const row = await db
		.selectFrom('collations')
		.select(['current_revision_id', 'current_content_hash'])
		.where('id', '=', collationId)
		.executeTakeFirst();
	if (!row?.current_revision_id || !row.current_content_hash) return null;
	return { revisionId: row.current_revision_id, contentHash: row.current_content_hash };
}

export interface TranscriptionCheckpointSummary {
	id: string;
	transcriptionId: string;
	parentCheckpointId: string | null;
	contentHash: string;
	isCommitted: boolean;
	commitMessage: string | null;
	authorName: string;
	createdAt: string;
}

export interface TranscriptionCheckpointPayload {
	project_transcription_id: string;
	id: string;
	format: string;
	title: string;
	siglum: string;
	description: string;
	content_json: unknown;
	owner: string | null;
	is_public: boolean;
	tags: string[];
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
	iiif_manifest_sources: SerializedIiifManifestSource[];
	page_canvas_links: SerializedTranscriptionPageCanvasLink[];
	canvas_annotations: SerializedIiifCanvasAnnotation[];
}

export interface LoadedTranscriptionCheckpoint {
	id: string;
	transcriptionId: string;
	parentCheckpointId: string | null;
	contentHash: string;
	isCommitted: boolean;
	commitMessage: string | null;
	authorName: string;
	createdAt: string;
	payload: TranscriptionCheckpointPayload;
}

export async function listCommittedTranscriptionCheckpoints(
	db: DbExecutor,
	transcriptionId: string
): Promise<TranscriptionCheckpointSummary[]> {
	const rows = await db
		.selectFrom('transcription_checkpoints')
		.select([
			'id',
			'transcription_id',
			'parent_checkpoint_id',
			'content_hash',
			'is_committed',
			'commit_message',
			'author_name',
			'created_at',
		])
		.where('transcription_id', '=', transcriptionId)
		.where('is_committed', '=', 1)
		.orderBy('created_at', 'desc')
		.orderBy('id', 'desc')
		.execute();
	return rows.map(row => ({
		id: requireId(row.id, 'transcription checkpoint'),
		transcriptionId: row.transcription_id,
		parentCheckpointId: row.parent_checkpoint_id,
		contentHash: row.content_hash,
		isCommitted: row.is_committed === 1,
		commitMessage: row.commit_message,
		authorName: row.author_name,
		createdAt: row.created_at,
	}));
}

export async function loadCommittedTranscriptionCheckpointPayload(
	db: DbExecutor,
	transcriptionId: string,
	checkpointId: string
): Promise<LoadedTranscriptionCheckpoint> {
	const row = await db
		.selectFrom('transcription_checkpoints')
		.selectAll()
		.where('id', '=', checkpointId)
		.where('transcription_id', '=', transcriptionId)
		.where('is_committed', '=', 1)
		.executeTakeFirst();
	if (!row) {
		throw new Error(
			`Committed transcription checkpoint ${checkpointId} for ${transcriptionId} was not found.`
		);
	}
	const payload = parseCheckpointPayload(
		row.payload,
		requireId(row.id, 'transcription checkpoint')
	);
	const contentHash = await hashCanonicalPayload(payload);
	if (contentHash !== row.content_hash) {
		throw new Error('Transcription checkpoint payload hash does not match its content hash.');
	}
	return {
		id: requireId(row.id, 'transcription checkpoint'),
		transcriptionId: row.transcription_id,
		parentCheckpointId: row.parent_checkpoint_id,
		contentHash: row.content_hash,
		isCommitted: row.is_committed === 1,
		commitMessage: row.commit_message,
		authorName: row.author_name,
		createdAt: row.created_at,
		payload,
	};
}

function parseCheckpointPayload(
	value: string,
	checkpointId: string
): TranscriptionCheckpointPayload {
	try {
		const parsed = JSON.parse(value);
		if (!parsed || typeof parsed !== 'object') {
			throw new Error('Checkpoint payload is not an object.');
		}
		return parsed as TranscriptionCheckpointPayload;
	} catch (error) {
		throw new Error(
			`Invalid transcription checkpoint payload for ${checkpointId}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
}

async function loadManifestSources(
	db: DbExecutor,
	transcriptionId: string
): Promise<SerializedIiifManifestSource[]> {
	const rows = await db
		.selectFrom('iiif_manifest_sources')
		.selectAll()
		.where('transcription_id', '=', transcriptionId)
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		id: requireId(row.id, 'manifest source'),
		manifest_url: row.manifest_url,
		label: row.label,
		source_kind: row.source_kind,
		default_canvas_id: row.default_canvas_id,
		default_image_service_url: row.default_image_service_url,
		metadata_json: parseJson(
			row.metadata_json,
			`iiif_manifest_sources.metadata_json for ${row.id}`
		),
	}));
}

function deriveCheckpointStatus(
	currentCheckpoint: EntityCheckpointHead | null,
	workingContentHash: string
): EntityCheckpointStatus {
	if (!currentCheckpoint) {
		return {
			currentCheckpoint: null,
			workingContentHash,
			dirtyToCheckpoint: true,
			commitState: 'never-committed',
		};
	}
	const dirtyToCheckpoint = workingContentHash !== currentCheckpoint.contentHash;
	return {
		currentCheckpoint,
		workingContentHash,
		dirtyToCheckpoint,
		commitState: dirtyToCheckpoint ? 'dirty' : 'clean',
	};
}

async function loadPageCanvasLinks(
	db: DbExecutor,
	transcriptionId: string
): Promise<SerializedTranscriptionPageCanvasLink[]> {
	const rows = await db
		.selectFrom('transcription_page_canvas_links')
		.selectAll()
		.where('transcription_id', '=', transcriptionId)
		.orderBy('page_order', 'asc')
		.orderBy('canvas_order', 'asc')
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		id: requireId(row.id, 'page canvas link'),
		page_id: row.page_id,
		page_name_snapshot: row.page_name_snapshot,
		page_order: row.page_order,
		manifest_source_id: row.manifest_source_id,
		manifest_url_snapshot: row.manifest_url_snapshot,
		canvas_id: row.canvas_id,
		canvas_order: row.canvas_order,
		canvas_label: row.canvas_label,
		image_service_url: row.image_service_url,
		thumbnail_url: row.thumbnail_url,
		link_role: row.link_role,
	}));
}

async function loadCanvasAnnotations(
	db: DbExecutor,
	transcriptionId: string
): Promise<SerializedIiifCanvasAnnotation[]> {
	const rows = await db
		.selectFrom('iiif_canvas_annotations')
		.selectAll()
		.where('transcription_id', '=', transcriptionId)
		.orderBy('annotation_id', 'asc')
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		id: requireId(row.id, 'canvas annotation'),
		manifest_source_id: row.manifest_source_id,
		canvas_id: row.canvas_id,
		page_id: row.page_id,
		annotation_id: row.annotation_id,
		annotation_kind: row.annotation_kind,
		body_json: parseJson(row.body_json, `iiif_canvas_annotations.body_json for ${row.id}`),
		target_json: parseJson(
			row.target_json,
			`iiif_canvas_annotations.target_json for ${row.id}`
		),
		anchor_json: parseJson(
			row.anchor_json,
			`iiif_canvas_annotations.anchor_json for ${row.id}`
		),
		motivation: row.motivation,
		created_by: row.created_by,
	}));
}

async function loadCollationWitnesses(
	db: DbExecutor,
	collationId: string
): Promise<SerializedCollationWitness[]> {
	const rows = await db
		.selectFrom('collation_witnesses')
		.selectAll()
		.where('collation_id', '=', collationId)
		.orderBy('position', 'asc')
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		id: requireId(row.id, 'collation witness'),
		witness_id: row.witness_id,
		content: row.content,
		position: row.position,
		project_transcription_id: row.project_transcription_id,
		transcription_id: row.transcription_id,
		source_revision_id: row.source_revision_id,
		source_content_hash: row.source_content_hash,
	}));
}

async function loadCollationTokens(
	db: DbExecutor,
	collationId: string
): Promise<SerializedCollationToken[]> {
	const rows = await db
		.selectFrom('collation_tokens')
		.selectAll()
		.where('collation_id', '=', collationId)
		.orderBy('witness_id', 'asc')
		.orderBy('token_index', 'asc')
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		id: requireId(row.id, 'collation token'),
		witness_id: row.witness_id,
		token_index: row.token_index,
		token_text: row.token_text,
	}));
}

async function loadCollationVariationUnits(
	db: DbExecutor,
	collationId: string
): Promise<SerializedCollationVariationUnit[]> {
	const rows = await db
		.selectFrom('collation_variation_units')
		.selectAll()
		.where('collation_id', '=', collationId)
		.orderBy('start_index', 'asc')
		.orderBy('end_index', 'asc')
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		id: requireId(row.id, 'variation unit'),
		start_index: row.start_index,
		end_index: row.end_index,
		unit_type: row.unit_type,
		base_text: row.base_text,
	}));
}

async function loadCollationReadings(
	db: DbExecutor,
	collationId: string
): Promise<SerializedCollationReading[]> {
	const rows = await db
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
			'collation_readings.is_lacuna as is_lacuna',
			'collation_readings.is_omission as is_omission',
		])
		.where('collation_variation_units.collation_id', '=', collationId)
		.orderBy('collation_readings.reading_order', 'asc')
		.orderBy('collation_readings.id', 'asc')
		.execute();
	return rows.map(row => ({
		id: requireId(row.id, 'collation reading'),
		variation_unit_id: row.variation_unit_id,
		reading_order: row.reading_order,
		reading_text: row.reading_text,
		is_lacuna: row.is_lacuna === 1,
		is_omission: row.is_omission === 1,
	}));
}

async function loadCollationReadingWitnesses(
	db: DbExecutor,
	collationId: string
): Promise<SerializedCollationReadingWitness[]> {
	return db
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
		.orderBy('collation_reading_witnesses.reading_id', 'asc')
		.orderBy('collation_reading_witnesses.witness_id', 'asc')
		.execute();
}

async function loadCollationArtifacts(
	db: DbExecutor,
	collationId: string
): Promise<SerializedCollationArtifact[]> {
	const rows = await db
		.selectFrom('collation_artifacts')
		.selectAll()
		.where('collation_id', '=', collationId)
		.orderBy('artifact_type', 'asc')
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		id: requireId(row.id, 'collation artifact'),
		artifact_type: row.artifact_type,
		payload: parseJsonIfPossible(row.payload),
	}));
}

function buildTranscriptionCheckpointRow(
	snapshot: ProjectTranscriptionSnapshot,
	parentCheckpointId: string | null,
	payload: unknown,
	contentHash: string,
	input: CommitTranscriptionInput
): Selectable<TranscriptionCheckpoints> {
	return {
		id: input.checkpointId ?? createId(),
		transcription_id: snapshot.id,
		parent_checkpoint_id: parentCheckpointId,
		format: snapshot.format,
		payload: canonicalJson(payload),
		content_hash: contentHash,
		is_committed: 1,
		commit_message: input.commitMessage ?? null,
		author_name: input.authorName ?? '',
		created_at: input.createdAt ?? new Date().toISOString(),
	};
}

function buildCollationCheckpointRow(
	collationId: string,
	parentCheckpointId: string | null,
	payload: unknown,
	contentHash: string,
	input: CommitCollationInput
): Selectable<CollationCheckpoints> {
	return {
		id: input.checkpointId ?? createId(),
		collation_id: collationId,
		parent_checkpoint_id: parentCheckpointId,
		payload: canonicalJson(payload),
		content_hash: contentHash,
		is_committed: 1,
		commit_message: input.commitMessage ?? null,
		author_name: input.authorName ?? '',
		created_at: input.createdAt ?? new Date().toISOString(),
	};
}

function mapTranscriptionCheckpoint(
	row: Selectable<TranscriptionCheckpoints>,
	projectTranscriptionId: string,
	payload: unknown
): TranscriptionCheckpoint {
	return {
		id: requireId(row.id, 'transcription checkpoint'),
		projectTranscriptionId,
		transcriptionId: row.transcription_id,
		parentCheckpointId: row.parent_checkpoint_id,
		format: row.format,
		payload,
		contentHash: row.content_hash,
		isCommitted: row.is_committed === 1,
		commitMessage: row.commit_message,
		authorName: row.author_name,
		createdAt: row.created_at,
	};
}

function mapCollationCheckpoint(
	row: Selectable<CollationCheckpoints>,
	payload: unknown
): CollationCheckpoint {
	return {
		id: requireId(row.id, 'collation checkpoint'),
		collationId: row.collation_id,
		parentCheckpointId: row.parent_checkpoint_id,
		payload,
		contentHash: row.content_hash,
		isCommitted: row.is_committed === 1,
		commitMessage: row.commit_message,
		authorName: row.author_name,
		createdAt: row.created_at,
	};
}

function parseJson(value: string, label: string): unknown {
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new Error(
			`Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

function parseJsonIfPossible(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function parseStringArray(value: string, label: string): string[] {
	const parsed = parseJson(value, label);
	if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== 'string')) {
		throw new Error(`Invalid string array in ${label}.`);
	}
	return parsed;
}

function groupBy<T>(values: T[], getKey: (value: T) => string): Map<string, T[]> {
	const grouped = new Map<string, T[]>();
	for (const value of values) {
		const key = getKey(value);
		const group = grouped.get(key) ?? [];
		group.push(value);
		grouped.set(key, group);
	}
	return grouped;
}

function compareById(left: { id: string }, right: { id: string }): number {
	return compareStrings(left.id, right.id);
}

function comparePageCanvasLinks(
	left: SerializedTranscriptionPageCanvasLink,
	right: SerializedTranscriptionPageCanvasLink
): number {
	return (
		compareNumbers(left.page_order, right.page_order) ||
		compareNumbers(left.canvas_order, right.canvas_order) ||
		compareStrings(left.id, right.id)
	);
}

function compareCanvasAnnotations(
	left: SerializedIiifCanvasAnnotation,
	right: SerializedIiifCanvasAnnotation
): number {
	return (
		compareStrings(left.annotation_id, right.annotation_id) || compareStrings(left.id, right.id)
	);
}

function compareCollationWitnesses(
	left: SerializedCollationWitness,
	right: SerializedCollationWitness
): number {
	return compareNumbers(left.position, right.position) || compareStrings(left.id, right.id);
}

function compareCollationTokens(
	left: SerializedCollationToken,
	right: SerializedCollationToken
): number {
	return (
		compareStrings(left.witness_id, right.witness_id) ||
		compareNumbers(left.token_index, right.token_index)
	);
}

function compareVariationUnits(
	left: SerializedCollationVariationUnit,
	right: SerializedCollationVariationUnit
): number {
	return (
		compareNumbers(left.start_index, right.start_index) ||
		compareNumbers(left.end_index, right.end_index) ||
		compareStrings(left.id, right.id)
	);
}

function compareCollationReadings(
	left: SerializedCollationReading,
	right: SerializedCollationReading
): number {
	return (
		compareNumbers(left.reading_order, right.reading_order) || compareStrings(left.id, right.id)
	);
}

function compareCollationArtifacts(
	left: SerializedCollationArtifact,
	right: SerializedCollationArtifact
): number {
	return (
		compareStrings(left.artifact_type, right.artifact_type) || compareStrings(left.id, right.id)
	);
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
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
