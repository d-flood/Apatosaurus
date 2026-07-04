import type { Kysely, Selectable, Transaction } from 'kysely';

import type { Database, SyncTombstones } from '$lib/client/db/types.generated';
import type { CreateProjectInput } from '$lib/client/db/repositories/projects';
import { getProject } from '$lib/client/db/repositories/projects';
import { openEnvelope, sealDocument, serializeSealedDocument } from '$lib/client/store/envelope';
import {
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CURRENT_VERSION,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FORMAT,
	TOMBSTONE_CURRENT_VERSION,
	TOMBSTONE_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	assertCollationCheckpointPayloadIntegrity,
	assertCollationRevisionHash,
	assertProjectTranscriptionRevisionHash,
	assertTranscriptionCheckpointPayloadIntegrity,
	readCanonicalDocument,
	type CollationCheckpointPayload,
	type CollationPayload,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type TombstonePayload,
	type TranscriptionCheckpointPayload,
} from '$lib/client/store/formats';
import { quarantineFromError as storeQuarantineFromError } from '$lib/client/store/quarantine';
import {
	buildCollationHashPayload,
	buildTranscriptionHashPayload,
	loadProjectTranscriptionSnapshot,
	loadSerializedCollation,
	type ProjectTranscriptionSnapshot,
	type SerializedCollation,
	type SerializedCollationArtifact,
	type SerializedCollationReading,
	type SerializedCollationReadingWitness,
	type SerializedCollationToken,
	type SerializedCollationVariationUnit,
	type SerializedCollationWitness,
	type SerializedIiifCanvasAnnotation,
	type SerializedIiifManifestSource,
	type SerializedTranscriptionPageCanvasLink,
} from '$lib/client/db/repositories/revisions';
import { canonicalJson, hashCanonicalPayload } from './canonical-json';
import { projectRelativeCloudPaths } from './cloud-paths';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export const CLOUD_FILE_SCHEMA_VERSION = 1;

export type CloudFileSchemaVersion = typeof CLOUD_FILE_SCHEMA_VERSION;
export type CloudHistoryEntityType = 'project-transcription' | 'collation';

export interface CloudCurrentRevision {
	id: string;
	content_hash: string;
	created_at: string;
	author_name: string;
}

export interface ProjectCloudFile {
	schema_version: CloudFileSchemaVersion;
	id: string;
	name: string;
	description: string;
	charter: string;
	collation_settings: unknown;
	manifest_content_hash: string;
	transcriptions: ProjectManifestTranscriptionHead[];
	collations: ProjectManifestCollationHead[];
	tombstones: ProjectManifestTombstoneHead[];
	created_at: string;
	updated_at: string;
}

export interface ProjectManifestRevisionHead {
	id: string;
	content_hash: string;
}

export interface ProjectManifestTranscriptionHead {
	project_transcription_id: string;
	transcription_id: string;
	current_revision: ProjectManifestRevisionHead | null;
	title: string;
	siglum: string;
	primary_path: string;
}

export interface ProjectManifestCollationHead {
	collation_id: string;
	current_revision: ProjectManifestRevisionHead | null;
	title: string;
	verse_identifier: string;
	primary_path: string;
}

export interface ProjectManifestTombstoneHead {
	tombstone_id: string;
	entity_type: string;
	entity_id: string;
	deletion_revision_id: string;
	content_hash: string;
	primary_path: string;
	deleted_at: string;
}

export interface ProjectTranscriptionOriginCloudFile {
	source_type: string;
	source_project_id: string | null;
	source_transcription_id: string | null;
	source_revision_id: string | null;
	source_content_hash: string | null;
}

export interface ProjectTranscriptionCloudFile extends ProjectTranscriptionSnapshot {
	schema_version: CloudFileSchemaVersion;
	scope_type: 'project_snapshot';
	canonical_transcription_id: string | null;
	current_revision: CloudCurrentRevision;
	origin: ProjectTranscriptionOriginCloudFile;
	created_at: string;
	updated_at: string;
}

export interface CollationCloudFile extends SerializedCollation {
	schema_version: CloudFileSchemaVersion;
	current_revision: CloudCurrentRevision;
	created_at: string;
	updated_at: string;
}

interface BaseHistoryCloudFile {
	schema_version: CloudFileSchemaVersion;
	checkpoint_id: string;
	entity_type: CloudHistoryEntityType;
	entity_id: string;
	parent_checkpoint_id: string | null;
	content_hash: string;
	commit_message: string | null;
	author_name: string;
	created_at: string;
	payload: unknown;
}

export interface ProjectTranscriptionHistoryCloudFile extends BaseHistoryCloudFile {
	entity_type: 'project-transcription';
	payload_transcription_id: string;
	format: string;
}

export interface CollationHistoryCloudFile extends BaseHistoryCloudFile {
	entity_type: 'collation';
}

export type HistoryCloudFile = ProjectTranscriptionHistoryCloudFile | CollationHistoryCloudFile;

export interface TombstoneCloudFile {
	schema_version: CloudFileSchemaVersion;
	id: string;
	project_id: string | null;
	entity_type: string;
	entity_id: string;
	cloud_path: string;
	deletion_revision_id: string;
	deleted_by: string;
	deleted_at: string;
}

export type CloudFile =
	| ProjectCloudFile
	| ProjectTranscriptionCloudFile
	| CollationCloudFile
	| HistoryCloudFile
	| TombstoneCloudFile;

export interface ProjectTranscriptionImportInput {
	project_id: string;
	project_transcription_id: string;
	transcription_id: string;
	canonical_transcription_id: string | null;
	scope_type: 'project_snapshot';
	origin: ProjectTranscriptionOriginCloudFile;
	current_revision_id: string;
	current_content_hash: string;
	title: string;
	siglum: string;
	description: string;
	content_json: unknown;
	format: string;
	created_at: string;
	updated_at: string;
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

export interface CollationImportInput extends SerializedCollation {
	current_revision_id: string;
	current_content_hash: string;
	created_at: string;
	updated_at: string;
}

export interface ProjectTranscriptionCheckpointImportInput {
	checkpoint_id: string;
	project_transcription_id: string;
	transcription_id: string;
	parent_checkpoint_id: string | null;
	format: string;
	payload: unknown;
	content_hash: string;
	commit_message: string | null;
	author_name: string;
	created_at: string;
}

export interface CollationCheckpointImportInput {
	checkpoint_id: string;
	collation_id: string;
	parent_checkpoint_id: string | null;
	payload: unknown;
	content_hash: string;
	commit_message: string | null;
	author_name: string;
	created_at: string;
}

export type CloudFileQuarantineCode =
	| 'invalid_json'
	| 'invalid_schema_version'
	| 'invalid_shape'
	| 'hash_mismatch';

export interface CloudFileQuarantine {
	code: CloudFileQuarantineCode;
	message: string;
	expected?: unknown;
	actual?: unknown;
}

export type CloudFileParseResult<T> =
	| { ok: true; value: T }
	| { ok: false; quarantine: CloudFileQuarantine };

export type CloudFileValidationResult =
	| { ok: true }
	| { ok: false; quarantine: CloudFileQuarantine };

export { projectCloudRootPath, projectRelativeCloudPaths } from './cloud-paths';
export type { ProjectCloudPaths } from './cloud-paths';

export async function serializeCloudFile(file: CloudFile): Promise<string> {
	const document = await cloudFileToCanonicalDocument(file);
	return serializeSealedDocument(document);
}

async function cloudFileToCanonicalDocument(file: CloudFile) {
	if (isProjectCloudFile(file)) {
		return sealDocument(
			PROJECT_MANIFEST_FORMAT,
			PROJECT_MANIFEST_CURRENT_VERSION,
			projectCloudFileToPayload(file)
		);
	}
	if (isProjectTranscriptionCloudFile(file)) {
		return sealDocument(
			PROJECT_TRANSCRIPTION_FORMAT,
			PROJECT_TRANSCRIPTION_CURRENT_VERSION,
			projectTranscriptionCloudFileToPayload(file)
		);
	}
	if (isCollationCloudFile(file)) {
		return sealDocument(COLLATION_FORMAT, COLLATION_CURRENT_VERSION, collationCloudFileToPayload(file));
	}
	if (isHistoryCloudFile(file)) {
		if (file.entity_type === 'project-transcription') {
			return sealDocument(
				TRANSCRIPTION_CHECKPOINT_FORMAT,
				1,
				transcriptionHistoryCloudFileToPayload(file)
			);
		}
		return sealDocument(
			COLLATION_CHECKPOINT_FORMAT,
			1,
			collationHistoryCloudFileToPayload(file)
		);
	}
	return sealDocument(TOMBSTONE_FORMAT, TOMBSTONE_CURRENT_VERSION, tombstoneCloudFileToPayload(file));
}

export async function serializeProjectCloudFile(
	db: DbExecutor,
	projectId: string
): Promise<ProjectCloudFile> {
	const project = await getProject(db, projectId);
	if (!project) throw new Error(`Project ${projectId} was not found.`);
	const [transcriptions, collations, tombstones] = await Promise.all([
		listProjectManifestTranscriptionHeads(db, projectId),
		listProjectManifestCollationHeads(db, projectId),
		listProjectManifestTombstoneHeads(db, projectId),
	]);
	const manifest_content_hash = await hashCanonicalPayload({
		project_id: project.id,
		transcriptions,
		collations,
		tombstones,
	});

	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		id: project.id,
		name: project.name,
		description: project.description,
		charter: project.charter,
		collation_settings: project.collationSettings,
		manifest_content_hash,
		transcriptions,
		collations,
		tombstones,
		created_at: project.createdAt,
		updated_at: project.updatedAt,
	};
}

export async function serializeProjectTranscriptionCloudFile(
	db: DbExecutor,
	projectTranscriptionId: string
): Promise<ProjectTranscriptionCloudFile> {
	const [snapshot, metadata] = await Promise.all([
		loadProjectTranscriptionSnapshot(db, projectTranscriptionId),
		loadProjectTranscriptionMetadata(db, projectTranscriptionId),
	]);
	void metadata;

	const contentHash = await hashCanonicalPayload(buildTranscriptionHashPayload(snapshot));
	if (contentHash !== metadata.current_content_hash) {
		throw new Error(
			`Project transcription ${projectTranscriptionId} has uncommitted changes and cannot be serialized for cloud sync.`
		);
	}
	const currentRevision = await loadTranscriptionRevision(
		db,
		snapshot.id,
		metadata.current_revision_id,
		metadata.current_content_hash
	);

	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		project_transcription_id: snapshot.project_transcription_id,
		id: snapshot.id,
		scope_type: 'project_snapshot',
		canonical_transcription_id: metadata.canonical_transcription_id,
		current_revision: currentRevision,
		origin: {
			source_type: metadata.origin_type,
			source_project_id: metadata.origin_project_id,
			source_transcription_id: emptyToNull(metadata.origin_transcription_id),
			source_revision_id: emptyToNull(metadata.origin_revision_id),
			source_content_hash: emptyToNull(metadata.origin_content_hash),
		},
		title: snapshot.title,
		siglum: snapshot.siglum,
		description: snapshot.description,
		content_json: snapshot.content_json,
		format: snapshot.format,
		created_at: metadata.created_at,
		updated_at: metadata.updated_at,
		owner: snapshot.owner,
		is_public: snapshot.is_public,
		tags: [...snapshot.tags],
		transcriber: snapshot.transcriber,
		repository: snapshot.repository,
		settlement: snapshot.settlement,
		language: snapshot.language,
		iiif_manifest_sources: sortManifestSources(snapshot.iiif_manifest_sources),
		page_canvas_links: sortPageCanvasLinks(snapshot.page_canvas_links),
		canvas_annotations: sortCanvasAnnotations(snapshot.canvas_annotations),
	};
}

export async function serializeCollationCloudFile(
	db: DbExecutor,
	collationId: string
): Promise<CollationCloudFile> {
	const [collation, metadata] = await Promise.all([
		loadSerializedCollation(db, collationId),
		loadCollationMetadata(db, collationId),
	]);
	assertCollationSourcesSyncReady(collation);
	const contentHash = await hashCanonicalPayload(buildCollationHashPayload(collation));
	if (contentHash !== metadata.current_content_hash) {
		throw new Error(
			`Collation ${collationId} has uncommitted changes and cannot be serialized for cloud sync.`
		);
	}
	const currentRevision = await loadCollationRevision(
		db,
		collation.id,
		metadata.current_revision_id,
		metadata.current_content_hash
	);

	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		id: collation.id,
		project_id: collation.project_id,
		title: collation.title,
		verse_identifier: collation.verse_identifier,
		status: collation.status,
		current_revision: currentRevision,
		group_path: collation.group_path,
		notes: collation.notes,
		sort_key: collation.sort_key,
		created_at: metadata.created_at,
		updated_at: metadata.updated_at,
		witnesses: sortCollationWitnesses(collation.witnesses),
		tokens: sortCollationTokens(collation.tokens),
		variation_units: sortVariationUnits(collation.variation_units),
		readings: sortCollationReadings(collation.readings),
		reading_witnesses: sortReadingWitnesses(collation.reading_witnesses),
		artifacts: sortCollationArtifacts(collation.artifacts),
	};
}

export async function serializeProjectTranscriptionHistoryCloudFile(
	db: DbExecutor,
	projectTranscriptionId: string,
	checkpointId: string
): Promise<ProjectTranscriptionHistoryCloudFile> {
	const link = await db
		.selectFrom('project_transcriptions')
		.select(['id', 'transcription_id'])
		.where('id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!link) throw new Error(`Project transcription ${projectTranscriptionId} was not found.`);

	const row = await db
		.selectFrom('transcription_checkpoints')
		.selectAll()
		.where('id', '=', checkpointId)
		.where('transcription_id', '=', link.transcription_id)
		.where('is_committed', '=', 1)
		.executeTakeFirst();
	if (!row) throw new Error(`Committed transcription checkpoint ${checkpointId} was not found.`);

	const payload = parseStoredJson(row.payload, `transcription checkpoint ${checkpointId}`);
	await assertHashMatches(payload, row.content_hash, `Transcription checkpoint ${checkpointId}`);

	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		checkpoint_id: requireId(row.id, 'transcription checkpoint'),
		entity_type: 'project-transcription',
		entity_id: projectTranscriptionId,
		payload_transcription_id: row.transcription_id,
		parent_checkpoint_id: row.parent_checkpoint_id,
		content_hash: row.content_hash,
		format: row.format,
		commit_message: row.commit_message,
		author_name: row.author_name,
		created_at: row.created_at,
		payload,
	};
}

export async function serializeCollationHistoryCloudFile(
	db: DbExecutor,
	collationId: string,
	checkpointId: string
): Promise<CollationHistoryCloudFile> {
	const row = await db
		.selectFrom('collation_checkpoints')
		.selectAll()
		.where('id', '=', checkpointId)
		.where('collation_id', '=', collationId)
		.where('is_committed', '=', 1)
		.executeTakeFirst();
	if (!row) throw new Error(`Committed collation checkpoint ${checkpointId} was not found.`);

	const payload = parseStoredJson(row.payload, `collation checkpoint ${checkpointId}`);
	await assertHashMatches(payload, row.content_hash, `Collation checkpoint ${checkpointId}`);

	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		checkpoint_id: requireId(row.id, 'collation checkpoint'),
		entity_type: 'collation',
		entity_id: row.collation_id,
		parent_checkpoint_id: row.parent_checkpoint_id,
		content_hash: row.content_hash,
		commit_message: row.commit_message,
		author_name: row.author_name,
		created_at: row.created_at,
		payload,
	};
}

export async function serializeTombstoneCloudFile(
	db: DbExecutor,
	tombstoneId: string
): Promise<TombstoneCloudFile> {
	const row = await db
		.selectFrom('sync_tombstones')
		.selectAll()
		.where('id', '=', tombstoneId)
		.executeTakeFirst();
	if (!row) throw new Error(`Tombstone ${tombstoneId} was not found.`);
	return tombstoneRowToCloudFile(row);
}

export async function parseProjectCloudFile(
	input: unknown
): Promise<CloudFileParseResult<ProjectCloudFile>> {
	const result = await readCanonicalDocument<ProjectManifestPayload>(PROJECT_MANIFEST_FORMAT, input);
	return result.ok
		? { ok: true, value: projectManifestPayloadToCloudFile(result.payload) }
		: { ok: false, quarantine: result.quarantine };
}

async function listProjectManifestTranscriptionHeads(
	db: DbExecutor,
	projectId: string
): Promise<ProjectManifestTranscriptionHead[]> {
	const paths = projectRelativeCloudPaths();
	const rows = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.transcription_id as transcription_id',
			'transcriptions.current_revision_id as current_revision_id',
			'transcriptions.current_content_hash as current_content_hash',
			'transcriptions.title as title',
			'transcriptions.siglum as siglum',
		])
		.where('project_transcriptions.project_id', '=', projectId)
		.orderBy('project_transcriptions.id', 'asc')
		.execute();
	return rows.map(row => ({
		project_transcription_id: requireId(row.project_transcription_id, 'project transcription'),
		transcription_id: row.transcription_id,
		current_revision: revisionHead(row.current_revision_id, row.current_content_hash),
		title: row.title,
		siglum: row.siglum,
		primary_path: paths.transcriptions(requireId(row.project_transcription_id, 'project transcription')),
	}));
}

async function listProjectManifestCollationHeads(
	db: DbExecutor,
	projectId: string
): Promise<ProjectManifestCollationHead[]> {
	const paths = projectRelativeCloudPaths();
	const rows = await db
		.selectFrom('collations')
		.select([
			'id',
			'current_revision_id',
			'current_content_hash',
			'title',
			'verse_identifier',
		])
		.where('project_id', '=', projectId)
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => ({
		collation_id: requireId(row.id, 'collation'),
		current_revision: revisionHead(row.current_revision_id, row.current_content_hash),
		title: row.title,
		verse_identifier: row.verse_identifier,
		primary_path: paths.collations(requireId(row.id, 'collation')),
	}));
}

async function listProjectManifestTombstoneHeads(
	db: DbExecutor,
	projectId: string
): Promise<ProjectManifestTombstoneHead[]> {
	const paths = projectRelativeCloudPaths();
	const rows = await db
		.selectFrom('sync_tombstones')
		.selectAll()
		.where('project_id', '=', projectId)
		.orderBy('id', 'asc')
		.execute();
	return Promise.all(
		rows.map(async row => {
			const tombstone = tombstoneRowToCloudFile(row);
			return {
				tombstone_id: tombstone.id,
				entity_type: tombstone.entity_type,
				entity_id: tombstone.entity_id,
				deletion_revision_id: tombstone.deletion_revision_id,
				content_hash: await hashCanonicalPayload(tombstone),
				primary_path: paths.tombstones(tombstone.id),
				deleted_at: tombstone.deleted_at,
			};
		})
	);
}

function revisionHead(
	revisionId: string | null,
	contentHash: string | null
): ProjectManifestRevisionHead | null {
	return revisionId && contentHash ? { id: revisionId, content_hash: contentHash } : null;
}

export async function parseProjectTranscriptionCloudFile(
	input: unknown
): Promise<CloudFileParseResult<ProjectTranscriptionCloudFile>> {
	const result = await readCanonicalDocument<ProjectTranscriptionPayload>(
		PROJECT_TRANSCRIPTION_FORMAT,
		input
	);
	if (!result.ok) return { ok: false, quarantine: result.quarantine };
	try {
		await assertProjectTranscriptionRevisionHash(result.payload);
		return { ok: true, value: projectTranscriptionPayloadToCloudFile(result.payload) };
	} catch (error) {
		return quarantineResult(error);
	}
}

export async function parseCollationCloudFile(
	input: unknown
): Promise<CloudFileParseResult<CollationCloudFile>> {
	const result = await readCanonicalDocument<CollationPayload>(COLLATION_FORMAT, input);
	if (!result.ok) return { ok: false, quarantine: result.quarantine };
	try {
		await assertCollationRevisionHash(result.payload);
		return { ok: true, value: collationPayloadToCloudFile(result.payload) };
	} catch (error) {
		return quarantineResult(error);
	}
}

export async function parseHistoryCloudFile(
	input: unknown
): Promise<CloudFileParseResult<HistoryCloudFile>> {
	try {
		const format = openEnvelope(input).header.format;
		if (format === TRANSCRIPTION_CHECKPOINT_FORMAT) {
			const result = await readCanonicalDocument<TranscriptionCheckpointPayload>(
				TRANSCRIPTION_CHECKPOINT_FORMAT,
				input
			);
			if (!result.ok) return { ok: false, quarantine: result.quarantine };
			await assertTranscriptionCheckpointPayloadIntegrity(result.payload);
			return { ok: true, value: transcriptionCheckpointPayloadToCloudFile(result.payload) };
		}
		if (format === COLLATION_CHECKPOINT_FORMAT) {
			const result = await readCanonicalDocument<CollationCheckpointPayload>(
				COLLATION_CHECKPOINT_FORMAT,
				input
			);
			if (!result.ok) return { ok: false, quarantine: result.quarantine };
			await assertCollationCheckpointPayloadIntegrity(result.payload);
			return { ok: true, value: collationCheckpointPayloadToCloudFile(result.payload) };
		}
		throw invalidShape('History cloud file must be a transcription or collation checkpoint.');
	} catch (error) {
		return quarantineResult(error);
	}
}

export async function parseTombstoneCloudFile(
	input: unknown
): Promise<CloudFileParseResult<TombstoneCloudFile>> {
	const result = await readCanonicalDocument<TombstonePayload>(TOMBSTONE_FORMAT, input);
	return result.ok
		? { ok: true, value: tombstonePayloadToCloudFile(result.payload) }
		: { ok: false, quarantine: result.quarantine };
}

export function validateProjectTranscriptionHeadMatchesCheckpoint(
	primary: ProjectTranscriptionCloudFile,
	checkpoint: HistoryCloudFile
): CloudFileValidationResult {
	try {
		if (checkpoint.entity_type !== 'project-transcription') {
			throw invalidShape(
				'Project transcription head must reference a project transcription checkpoint.'
			);
		}
		if (checkpoint.entity_id !== primary.project_transcription_id) {
			throw invalidShape(
				'Project transcription checkpoint entity id does not match the primary file.'
			);
		}
		if (checkpoint.payload_transcription_id !== primary.id) {
			throw invalidShape(
				'Project transcription checkpoint payload id does not match the primary file.'
			);
		}
		if (checkpoint.checkpoint_id !== primary.current_revision.id) {
			throw new CloudFileValidationError(
				'hash_mismatch',
				'Project transcription current revision id does not match its checkpoint file.',
				primary.current_revision.id,
				checkpoint.checkpoint_id
			);
		}
		if (checkpoint.content_hash !== primary.current_revision.content_hash) {
			throw new CloudFileValidationError(
				'hash_mismatch',
				'Project transcription current revision hash does not match its checkpoint file.',
				primary.current_revision.content_hash,
				checkpoint.content_hash
			);
		}
		return { ok: true };
	} catch (error) {
		return validationResult(error);
	}
}

export function validateCollationHeadMatchesCheckpoint(
	primary: CollationCloudFile,
	checkpoint: HistoryCloudFile
): CloudFileValidationResult {
	try {
		if (checkpoint.entity_type !== 'collation') {
			throw invalidShape('Collation head must reference a collation checkpoint.');
		}
		if (checkpoint.entity_id !== primary.id) {
			throw invalidShape('Collation checkpoint entity id does not match the primary file.');
		}
		if (checkpoint.checkpoint_id !== primary.current_revision.id) {
			throw new CloudFileValidationError(
				'hash_mismatch',
				'Collation current revision id does not match its checkpoint file.',
				primary.current_revision.id,
				checkpoint.checkpoint_id
			);
		}
		if (checkpoint.content_hash !== primary.current_revision.content_hash) {
			throw new CloudFileValidationError(
				'hash_mismatch',
				'Collation current revision hash does not match its checkpoint file.',
				primary.current_revision.content_hash,
				checkpoint.content_hash
			);
		}
		return { ok: true };
	} catch (error) {
		return validationResult(error);
	}
}

export function projectCloudFileToRepositoryInput(file: ProjectCloudFile): CreateProjectInput {
	return {
		id: file.id,
		name: file.name,
		description: file.description,
		charter: file.charter,
		collationSettings: file.collation_settings,
		createdAt: file.created_at,
		updatedAt: file.updated_at,
	};
}

export function projectTranscriptionCloudFileToImportInput(
	projectId: string,
	file: ProjectTranscriptionCloudFile
): ProjectTranscriptionImportInput {
	return {
		project_id: projectId,
		project_transcription_id: file.project_transcription_id,
		transcription_id: file.id,
		canonical_transcription_id: file.canonical_transcription_id,
		scope_type: file.scope_type,
		origin: { ...file.origin },
		current_revision_id: file.current_revision.id,
		current_content_hash: file.current_revision.content_hash,
		title: file.title,
		siglum: file.siglum,
		description: file.description,
		content_json: file.content_json,
		format: file.format,
		created_at: file.created_at,
		updated_at: file.updated_at,
		owner: file.owner,
		is_public: file.is_public,
		tags: [...file.tags],
		transcriber: file.transcriber,
		repository: file.repository,
		settlement: file.settlement,
		language: file.language,
		iiif_manifest_sources: sortManifestSources(file.iiif_manifest_sources),
		page_canvas_links: sortPageCanvasLinks(file.page_canvas_links),
		canvas_annotations: sortCanvasAnnotations(file.canvas_annotations),
	};
}

export function collationCloudFileToImportInput(file: CollationCloudFile): CollationImportInput {
	return {
		id: file.id,
		project_id: file.project_id,
		title: file.title,
		verse_identifier: file.verse_identifier,
		status: file.status,
		group_path: file.group_path,
		notes: file.notes,
		sort_key: file.sort_key,
		current_revision_id: file.current_revision.id,
		current_content_hash: file.current_revision.content_hash,
		created_at: file.created_at,
		updated_at: file.updated_at,
		witnesses: sortCollationWitnesses(file.witnesses),
		tokens: sortCollationTokens(file.tokens),
		variation_units: sortVariationUnits(file.variation_units),
		readings: sortCollationReadings(file.readings),
		reading_witnesses: sortReadingWitnesses(file.reading_witnesses),
		artifacts: sortCollationArtifacts(file.artifacts),
	};
}

export function historyCloudFileToImportInput(
	file: HistoryCloudFile
): ProjectTranscriptionCheckpointImportInput | CollationCheckpointImportInput {
	if (file.entity_type === 'project-transcription') {
		return {
			checkpoint_id: file.checkpoint_id,
			project_transcription_id: file.entity_id,
			transcription_id: file.payload_transcription_id,
			parent_checkpoint_id: file.parent_checkpoint_id,
			format: file.format,
			payload: file.payload,
			content_hash: file.content_hash,
			commit_message: file.commit_message,
			author_name: file.author_name,
			created_at: file.created_at,
		};
	}
	return {
		checkpoint_id: file.checkpoint_id,
		collation_id: file.entity_id,
		parent_checkpoint_id: file.parent_checkpoint_id,
		payload: file.payload,
		content_hash: file.content_hash,
		commit_message: file.commit_message,
		author_name: file.author_name,
		created_at: file.created_at,
	};
}

export function tombstoneCloudFileToRow(file: TombstoneCloudFile): Selectable<SyncTombstones> {
	return {
		id: file.id,
		project_id: file.project_id,
		entity_type: file.entity_type,
		entity_id: file.entity_id,
		cloud_path: file.cloud_path,
		deletion_revision_id: file.deletion_revision_id,
		deleted_by: file.deleted_by,
		deleted_at: file.deleted_at,
	};
}

function isProjectCloudFile(file: CloudFile): file is ProjectCloudFile {
	return 'manifest_content_hash' in file;
}

function isProjectTranscriptionCloudFile(file: CloudFile): file is ProjectTranscriptionCloudFile {
	return 'project_transcription_id' in file && 'current_revision' in file;
}

function isCollationCloudFile(file: CloudFile): file is CollationCloudFile {
	return 'verse_identifier' in file && 'witnesses' in file && 'current_revision' in file;
}

function isHistoryCloudFile(file: CloudFile): file is HistoryCloudFile {
	return 'checkpoint_id' in file;
}

function projectCloudFileToPayload(file: ProjectCloudFile): ProjectManifestPayload {
	return {
		id: file.id,
		name: file.name,
		description: file.description,
		charter: file.charter,
		collation_settings: file.collation_settings as ProjectManifestPayload['collation_settings'],
		manifest_content_hash: file.manifest_content_hash,
		transcriptions: file.transcriptions as ProjectManifestPayload['transcriptions'],
		collations: file.collations as ProjectManifestPayload['collations'],
		tombstones: file.tombstones as ProjectManifestPayload['tombstones'],
		created_at: file.created_at,
		updated_at: file.updated_at,
	};
}

function projectManifestPayloadToCloudFile(payload: ProjectManifestPayload): ProjectCloudFile {
	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		id: payload.id,
		name: payload.name,
		description: payload.description,
		charter: payload.charter,
		collation_settings: payload.collation_settings,
		manifest_content_hash: payload.manifest_content_hash,
		transcriptions: payload.transcriptions,
		collations: payload.collations,
		tombstones: payload.tombstones,
		created_at: payload.created_at,
		updated_at: payload.updated_at,
	};
}

function projectTranscriptionCloudFileToPayload(
	file: ProjectTranscriptionCloudFile
): ProjectTranscriptionPayload {
	return {
		project_transcription_id: file.project_transcription_id,
		id: file.id,
		scope_type: file.scope_type,
		canonical_transcription_id: file.canonical_transcription_id,
		current_revision: file.current_revision as ProjectTranscriptionPayload['current_revision'],
		origin: file.origin as ProjectTranscriptionPayload['origin'],
		title: file.title,
		siglum: file.siglum,
		description: file.description,
		content_json: file.content_json as ProjectTranscriptionPayload['content_json'],
		content_format: file.format,
		created_at: file.created_at,
		updated_at: file.updated_at,
		owner: file.owner,
		is_public: file.is_public,
		tags: [...file.tags],
		transcriber: file.transcriber,
		repository: file.repository,
		settlement: file.settlement,
		language: file.language,
		iiif_manifest_sources:
			file.iiif_manifest_sources as ProjectTranscriptionPayload['iiif_manifest_sources'],
		page_canvas_links: file.page_canvas_links as ProjectTranscriptionPayload['page_canvas_links'],
		canvas_annotations: file.canvas_annotations as ProjectTranscriptionPayload['canvas_annotations'],
	};
}

function projectTranscriptionPayloadToCloudFile(
	payload: ProjectTranscriptionPayload
): ProjectTranscriptionCloudFile {
	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		project_transcription_id: payload.project_transcription_id,
		id: payload.id,
		scope_type: payload.scope_type,
		canonical_transcription_id: payload.canonical_transcription_id,
		current_revision: payload.current_revision,
		origin: payload.origin,
		title: payload.title,
		siglum: payload.siglum,
		description: payload.description,
		content_json: payload.content_json,
		format: payload.content_format,
		created_at: payload.created_at,
		updated_at: payload.updated_at,
		owner: payload.owner,
		is_public: payload.is_public,
		tags: [...payload.tags],
		transcriber: payload.transcriber,
		repository: payload.repository,
		settlement: payload.settlement,
		language: payload.language,
		iiif_manifest_sources: payload.iiif_manifest_sources,
		page_canvas_links: payload.page_canvas_links,
		canvas_annotations: payload.canvas_annotations,
	};
}

function collationCloudFileToPayload(file: CollationCloudFile): CollationPayload {
	return {
		id: file.id,
		project_id: file.project_id,
		title: file.title,
		verse_identifier: file.verse_identifier,
		status: file.status,
		current_revision: file.current_revision as CollationPayload['current_revision'],
		group_path: file.group_path,
		notes: file.notes,
		sort_key: file.sort_key,
		created_at: file.created_at,
		updated_at: file.updated_at,
		witnesses: file.witnesses as CollationPayload['witnesses'],
		tokens: file.tokens as CollationPayload['tokens'],
		variation_units: file.variation_units as CollationPayload['variation_units'],
		readings: file.readings as CollationPayload['readings'],
		reading_witnesses: file.reading_witnesses as CollationPayload['reading_witnesses'],
		artifacts: file.artifacts as CollationPayload['artifacts'],
	};
}

function collationPayloadToCloudFile(payload: CollationPayload): CollationCloudFile {
	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		id: payload.id,
		project_id: payload.project_id,
		title: payload.title,
		verse_identifier: payload.verse_identifier,
		status: payload.status,
		current_revision: payload.current_revision,
		group_path: payload.group_path,
		notes: payload.notes,
		sort_key: payload.sort_key,
		created_at: payload.created_at,
		updated_at: payload.updated_at,
		witnesses: payload.witnesses,
		tokens: payload.tokens,
		variation_units: payload.variation_units,
		readings: payload.readings,
		reading_witnesses: payload.reading_witnesses,
		artifacts: payload.artifacts,
	};
}

function transcriptionHistoryCloudFileToPayload(
	file: ProjectTranscriptionHistoryCloudFile
): TranscriptionCheckpointPayload {
	return {
		checkpoint_id: file.checkpoint_id,
		entity_type: file.entity_type,
		entity_id: file.entity_id,
		payload_transcription_id: file.payload_transcription_id,
		parent_checkpoint_id: file.parent_checkpoint_id,
		payload_content_hash: file.content_hash,
		content_format: file.format,
		commit_message: file.commit_message,
		author_name: file.author_name,
		created_at: file.created_at,
		payload: file.payload as TranscriptionCheckpointPayload['payload'],
	};
}

function transcriptionCheckpointPayloadToCloudFile(
	payload: TranscriptionCheckpointPayload
): ProjectTranscriptionHistoryCloudFile {
	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		checkpoint_id: payload.checkpoint_id,
		entity_type: payload.entity_type,
		entity_id: payload.entity_id,
		payload_transcription_id: payload.payload_transcription_id,
		parent_checkpoint_id: payload.parent_checkpoint_id,
		content_hash: payload.payload_content_hash,
		format: payload.content_format,
		commit_message: payload.commit_message,
		author_name: payload.author_name,
		created_at: payload.created_at,
		payload: payload.payload,
	};
}

function collationHistoryCloudFileToPayload(file: CollationHistoryCloudFile): CollationCheckpointPayload {
	return {
		checkpoint_id: file.checkpoint_id,
		entity_type: file.entity_type,
		entity_id: file.entity_id,
		parent_checkpoint_id: file.parent_checkpoint_id,
		payload_content_hash: file.content_hash,
		commit_message: file.commit_message,
		author_name: file.author_name,
		created_at: file.created_at,
		payload: file.payload as CollationCheckpointPayload['payload'],
	};
}

function collationCheckpointPayloadToCloudFile(
	payload: CollationCheckpointPayload
): CollationHistoryCloudFile {
	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		checkpoint_id: payload.checkpoint_id,
		entity_type: payload.entity_type,
		entity_id: payload.entity_id,
		parent_checkpoint_id: payload.parent_checkpoint_id,
		content_hash: payload.payload_content_hash,
		commit_message: payload.commit_message,
		author_name: payload.author_name,
		created_at: payload.created_at,
		payload: payload.payload,
	};
}

function tombstoneCloudFileToPayload(file: TombstoneCloudFile): TombstonePayload {
	return {
		id: file.id,
		project_id: file.project_id,
		entity_type: file.entity_type,
		entity_id: file.entity_id,
		cloud_path: file.cloud_path,
		deletion_revision_id: file.deletion_revision_id,
		deleted_by: file.deleted_by,
		deleted_at: file.deleted_at,
	};
}

function tombstonePayloadToCloudFile(payload: TombstonePayload): TombstoneCloudFile {
	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		id: payload.id,
		project_id: payload.project_id,
		entity_type: payload.entity_type,
		entity_id: payload.entity_id,
		cloud_path: payload.cloud_path,
		deletion_revision_id: payload.deletion_revision_id,
		deleted_by: payload.deleted_by,
		deleted_at: payload.deleted_at,
	};
}

async function loadProjectTranscriptionMetadata(db: DbExecutor, projectTranscriptionId: string) {
	const row = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select([
			'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
			'transcriptions.origin_type as origin_type',
			'transcriptions.origin_project_id as origin_project_id',
			'transcriptions.origin_transcription_id as origin_transcription_id',
			'transcriptions.origin_revision_id as origin_revision_id',
			'transcriptions.origin_content_hash as origin_content_hash',
			'transcriptions.current_revision_id as current_revision_id',
			'transcriptions.current_content_hash as current_content_hash',
			'transcriptions.created_at as created_at',
			'transcriptions.updated_at as updated_at',
		])
		.where('project_transcriptions.id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Project transcription ${projectTranscriptionId} was not found.`);
	return row;
}

async function loadCollationMetadata(db: DbExecutor, collationId: string) {
	const row = await db
		.selectFrom('collations')
		.select(['current_revision_id', 'current_content_hash', 'created_at', 'updated_at'])
		.where('id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);
	return row;
}

async function loadTranscriptionRevision(
	db: DbExecutor,
	transcriptionId: string,
	checkpointId: string,
	expectedHash: string
): Promise<CloudCurrentRevision> {
	if (!checkpointId || !expectedHash) {
		throw new Error(`Transcription ${transcriptionId} has no committed revision.`);
	}
	const row = await db
		.selectFrom('transcription_checkpoints')
		.selectAll()
		.where('id', '=', checkpointId)
		.where('transcription_id', '=', transcriptionId)
		.where('is_committed', '=', 1)
		.executeTakeFirst();
	if (!row) throw new Error(`Committed transcription checkpoint ${checkpointId} was not found.`);
	if (row.content_hash !== expectedHash) {
		throw new Error(
			`Transcription checkpoint ${checkpointId} does not match the current revision hash.`
		);
	}
	const payload = parseStoredJson(row.payload, `transcription checkpoint ${checkpointId}`);
	await assertHashMatches(payload, row.content_hash, `Transcription checkpoint ${checkpointId}`);
	return {
		id: requireId(row.id, 'transcription checkpoint'),
		content_hash: row.content_hash,
		created_at: row.created_at,
		author_name: row.author_name,
	};
}

async function loadCollationRevision(
	db: DbExecutor,
	collationId: string,
	checkpointId: string,
	expectedHash: string
): Promise<CloudCurrentRevision> {
	if (!checkpointId || !expectedHash) {
		throw new Error(`Collation ${collationId} has no committed revision.`);
	}
	const row = await db
		.selectFrom('collation_checkpoints')
		.selectAll()
		.where('id', '=', checkpointId)
		.where('collation_id', '=', collationId)
		.where('is_committed', '=', 1)
		.executeTakeFirst();
	if (!row) throw new Error(`Committed collation checkpoint ${checkpointId} was not found.`);
	if (row.content_hash !== expectedHash) {
		throw new Error(
			`Collation checkpoint ${checkpointId} does not match the current revision hash.`
		);
	}
	const payload = parseStoredJson(row.payload, `collation checkpoint ${checkpointId}`);
	await assertHashMatches(payload, row.content_hash, `Collation checkpoint ${checkpointId}`);
	return {
		id: requireId(row.id, 'collation checkpoint'),
		content_hash: row.content_hash,
		created_at: row.created_at,
		author_name: row.author_name,
	};
}

function tombstoneRowToCloudFile(row: Selectable<SyncTombstones>): TombstoneCloudFile {
	return {
		schema_version: CLOUD_FILE_SCHEMA_VERSION,
		id: requireId(row.id, 'tombstone'),
		project_id: row.project_id,
		entity_type: row.entity_type,
		entity_id: row.entity_id,
		cloud_path: row.cloud_path,
		deletion_revision_id: row.deletion_revision_id,
		deleted_by: row.deleted_by,
		deleted_at: row.deleted_at,
	};
}

function assertCollationSourcesSyncReady(collation: SerializedCollation): void {
	const missing = collation.witnesses.find(
		witness =>
			!witness.project_transcription_id ||
			!witness.transcription_id ||
			!witness.source_revision_id ||
			!witness.source_content_hash
	);
	if (!missing) return;
	throw new Error(
		`Collation ${collation.id} witness ${missing.witness_id} is missing committed source revision metadata and cannot be serialized for cloud sync.`
	);
}

async function assertHashMatches(
	payload: unknown,
	expectedHash: string,
	label: string
): Promise<void> {
	let actualHash: string;
	try {
		actualHash = await hashCanonicalPayload(payload);
	} catch (error) {
		throw invalidShape(`${label} payload is not canonicalizable: ${errorMessage(error)}`);
	}
	if (actualHash !== expectedHash) {
		throw new CloudFileValidationError(
			'hash_mismatch',
			`${label} content hash mismatch.`,
			expectedHash,
			actualHash
		);
	}
}

function parseStoredJson(value: string, label: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch (error) {
		throw new Error(`Invalid JSON in ${label}: ${errorMessage(error)}`);
	}
}

function quarantineResult<T>(error: unknown): CloudFileParseResult<T> {
	return { ok: false, quarantine: quarantineFromError(error) };
}

function validationResult(error: unknown): CloudFileValidationResult {
	return { ok: false, quarantine: quarantineFromError(error) };
}

function quarantineFromError(error: unknown): CloudFileQuarantine {
	if (error instanceof CloudFileValidationError) {
		return {
			code: error.code,
			message: error.message,
			expected: error.expected,
			actual: error.actual,
		};
	}
	return storeQuarantineFromError(error);
}

class CloudFileValidationError extends Error {
	constructor(
		readonly code: CloudFileQuarantineCode,
		message: string,
		readonly expected?: unknown,
		readonly actual?: unknown
	) {
		super(message);
		this.name = 'CloudFileValidationError';
	}
}

function invalidShape(message: string): CloudFileValidationError {
	return new CloudFileValidationError('invalid_shape', message);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function emptyToNull(value: string | null): string | null {
	return value || null;
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} id.`);
	return value;
}

function sortManifestSources(rows: SerializedIiifManifestSource[]): SerializedIiifManifestSource[] {
	return [...rows].sort(compareById);
}

function sortPageCanvasLinks(
	rows: SerializedTranscriptionPageCanvasLink[]
): SerializedTranscriptionPageCanvasLink[] {
	return [...rows].sort(comparePageCanvasLinks);
}

function sortCanvasAnnotations(
	rows: SerializedIiifCanvasAnnotation[]
): SerializedIiifCanvasAnnotation[] {
	return [...rows].sort(compareCanvasAnnotations);
}

function sortCollationWitnesses(rows: SerializedCollationWitness[]): SerializedCollationWitness[] {
	return [...rows].sort(compareCollationWitnesses);
}

function sortCollationTokens(rows: SerializedCollationToken[]): SerializedCollationToken[] {
	return [...rows].sort(compareCollationTokens);
}

function sortVariationUnits(
	rows: SerializedCollationVariationUnit[]
): SerializedCollationVariationUnit[] {
	return [...rows].sort(compareVariationUnits);
}

function sortCollationReadings(rows: SerializedCollationReading[]): SerializedCollationReading[] {
	return [...rows].sort(compareCollationReadings);
}

function sortReadingWitnesses(
	rows: SerializedCollationReadingWitness[]
): SerializedCollationReadingWitness[] {
	return [...rows].sort(compareReadingWitnesses);
}

function sortCollationArtifacts(
	rows: SerializedCollationArtifact[]
): SerializedCollationArtifact[] {
	return [...rows].sort(compareCollationArtifacts);
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
		compareNumbers(left.token_index, right.token_index) ||
		compareStrings(left.id, right.id)
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
		compareStrings(left.variation_unit_id, right.variation_unit_id) ||
		compareNumbers(left.reading_order, right.reading_order) ||
		compareStrings(left.id, right.id)
	);
}

function compareReadingWitnesses(
	left: SerializedCollationReadingWitness,
	right: SerializedCollationReadingWitness
): number {
	return (
		compareStrings(left.reading_id, right.reading_id) ||
		compareStrings(left.witness_id, right.witness_id)
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
