import type { Kysely } from 'kysely';

import {
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CURRENT_VERSION,
	COLLATION_FORMAT,
	assertCollationRevisionHash,
	collationCheckpointFile,
	collationDocumentToTei,
	collationPrimaryFile,
	collationTeiFile,
	collationWorkingFile,
	readCanonicalDocument,
	readTextFile,
	sealDocument,
	serializeSealedDocument,
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FORMAT,
	writeTextFileAtomic,
	type JsonObject,
	type JsonValue,
	type CollationCheckpointPayload as CanonicalCollationCheckpointPayload,
	type CollationPayload,
	type StoreOperationOptions,
	type WorkingCollationPayload,
} from '$lib/client/store';
import { parseCollationDocument } from '$lib/client/collation/collation-document';
import { hashCanonicalPayload } from '$lib/client/sync/canonical-json';
import { deriveEntityCloudBackupState } from '$lib/client/sync/backup-status';

import type { Database } from '../types.generated';
import { writeProjectManifestFile } from './project-files';
import {
	getCollationVersionStatus,
	loadCollation,
	type CollationArtifactRecord,
	type CollationProjectionRecord,
	type CollationVersionStatus,
	type CollationVersionStatusOptions,
	type LoadedCollation,
	type SaveCollationArtifactInput,
} from './collations';
import {
	buildCollationHashPayload,
	createCommittedCollationCheckpointFromSerialized,
	loadSerializedCollation,
	type CollationCheckpoint,
	type CommitCollationInput,
	type SerializedCollation,
	type SerializedCollationArtifact,
	type SerializedCollationReading,
	type SerializedCollationReadingWitness,
	type SerializedCollationToken,
	type SerializedCollationVariationUnit,
	type SerializedCollationWitness,
} from './revisions';

interface CollationFileContext {
	collationId: string;
	projectId: string;
	projectStorageSlug: string;
	currentRevisionId: string | null;
	currentContentHash: string | null;
	createdAt: string;
	updatedAt: string;
}

interface CollationCommitSource {
	collation: SerializedCollation;
	createdAt: string;
	updatedAt: string;
}

type LoadedWorkingCollationArtifact = JsonObject & Omit<SerializedCollationArtifact, 'payload'> & {
	payload: JsonValue;
};

interface LoadedWorkingCollationPayload extends Omit<SerializedCollation, 'artifacts'> {
	created_at: string;
	updated_at: string;
	witnesses: SerializedCollationWitness[];
	tokens: SerializedCollationToken[];
	variation_units: SerializedCollationVariationUnit[];
	readings: SerializedCollationReading[];
	reading_witnesses: SerializedCollationReadingWitness[];
	artifacts: LoadedWorkingCollationArtifact[];
	draft: {
		base_revision_id: string | null;
		base_content_hash: string | null;
		saved_at: string;
		author_name: string | null;
	};
}

export async function saveWorkingCollationArtifact(
	db: Kysely<Database>,
	input: SaveCollationArtifactInput,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const updatedAt = input.now ?? new Date().toISOString();
	const [context, collation] = await Promise.all([
		loadCollationFileContext(db, input.collationId),
		loadSerializedCollation(db, input.collationId),
	]);
	const artifactPayload = parseJsonValue(
		input.payload,
		`collation ${input.collationId} ${input.artifactType} payload`
	);
	const artifactId = input.artifactId || crypto.randomUUID();
	const payload = buildWorkingCollationPayload(collation, context, {
		artifactId,
		artifactType: input.artifactType,
		artifactPayload,
		updatedAt,
	});
	const document = await sealDocument(
		WORKING_COLLATION_FORMAT,
		WORKING_COLLATION_CURRENT_VERSION,
		payload
	);

	await writeTextFileAtomic(
		collationWorkingFile(context.projectStorageSlug, input.collationId),
		serializeSealedDocument(document),
		storeOptions
	);
	return artifactId;
}

export async function createCommittedCollationCheckpointWithFiles(
	db: Kysely<Database>,
	input: CommitCollationInput,
	storeOptions: StoreOperationOptions = {}
): Promise<CollationCheckpoint> {
	const context = await loadCollationFileContext(db, input.collationId);
	const source = await loadCollationCommitSource(db, context, storeOptions);
	const payload = buildCollationHashPayload(source.collation);
	const contentHash = await hashCanonicalPayload(payload);
	const checkpointId = input.checkpointId ?? createId();
	const createdAt = input.createdAt ?? new Date().toISOString();
	const authorName = input.authorName ?? '';
	const commitMessage = input.commitMessage ?? null;
	const checkpointPayload: CanonicalCollationCheckpointPayload = {
		checkpoint_id: checkpointId,
		entity_type: 'collation',
		entity_id: source.collation.id,
		parent_checkpoint_id: context.currentRevisionId,
		payload_content_hash: contentHash,
		commit_message: commitMessage,
		author_name: authorName,
		created_at: createdAt,
		payload: payload as JsonValue,
	};
	const checkpointPath = collationCheckpointFile(
		context.projectStorageSlug,
		context.collationId,
		checkpointId
	);
	await assertFileMissing(checkpointPath, storeOptions);
	await writeSealedJsonFile(
		checkpointPath,
		COLLATION_CHECKPOINT_FORMAT,
		COLLATION_CHECKPOINT_CURRENT_VERSION,
		checkpointPayload,
		storeOptions
	);

	const primaryPayload: CollationPayload = {
		id: source.collation.id,
		project_id: source.collation.project_id,
		title: source.collation.title,
		verse_identifier: source.collation.verse_identifier,
		status: source.collation.status,
		current_revision: {
			id: checkpointId,
			content_hash: contentHash,
			created_at: createdAt,
			author_name: authorName,
		},
		group_path: source.collation.group_path,
		notes: source.collation.notes,
		sort_key: source.collation.sort_key,
		created_at: source.createdAt,
		updated_at: source.updatedAt,
		witnesses: source.collation.witnesses.map(row => ({ ...row })) as CollationPayload['witnesses'],
		tokens: source.collation.tokens.map(row => ({ ...row })) as CollationPayload['tokens'],
		variation_units: source.collation.variation_units.map(row => ({
			...row,
		})) as CollationPayload['variation_units'],
		readings: source.collation.readings.map(row => ({ ...row })) as CollationPayload['readings'],
		reading_witnesses: source.collation.reading_witnesses.map(row => ({
			...row,
		})) as CollationPayload['reading_witnesses'],
		artifacts: source.collation.artifacts.map(row => ({
			id: row.id,
			artifact_type: row.artifact_type,
			payload: toJsonValue(row.payload, `collation artifact ${row.id}`),
		})) as CollationPayload['artifacts'],
	};
	await assertCollationRevisionHash(primaryPayload);
	await writeSealedJsonFile(
		collationPrimaryFile(context.projectStorageSlug, context.collationId),
		COLLATION_FORMAT,
		COLLATION_CURRENT_VERSION,
		primaryPayload,
		storeOptions
	);
	await writeDerivedCollationTei(
		context.projectStorageSlug,
		context.collationId,
		primaryPayload,
		storeOptions
	);
	await writeProjectManifestFile(
		db,
		context.projectId,
		{
			collations: {
				[context.collationId]: { id: checkpointId, content_hash: contentHash },
			},
		},
		storeOptions
	);

	return createCommittedCollationCheckpointFromSerialized(db, source.collation, {
		...input,
		checkpointId,
		createdAt,
		authorName,
		commitMessage,
	});
}

export async function loadCollationWithWorkingFile(
	db: Kysely<Database>,
	collationId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<LoadedCollation | null> {
	const loaded = await loadCollation(db, collationId);
	if (!loaded) return null;
	const context = await loadCollationFileContext(db, collationId);
	const payload = await tryReadWorkingCollationPayload(context, storeOptions);
	if (!payload) return loaded;
	return loadedCollationFromWorkingPayload(loaded, payload);
}

export async function getCollationVersionStatusWithWorkingFile(
	db: Kysely<Database>,
	collationId: string,
	options: CollationVersionStatusOptions = {},
	storeOptions: StoreOperationOptions = {}
): Promise<CollationVersionStatus> {
	const base = await getCollationVersionStatus(db, collationId, options);
	const context = await loadCollationFileContext(db, collationId);
	const payload = await tryReadWorkingCollationPayload(context, storeOptions);
	if (!payload) return base;

	const workingContentHash = await hashCanonicalPayload(
		buildCollationHashPayload(serializedCollationFromWorkingPayload(payload))
	);
	const dirtyToCheckpoint = base.currentCheckpoint
		? workingContentHash !== base.currentCheckpoint.contentHash
		: true;
	const commitState = base.currentCheckpoint
		? dirtyToCheckpoint
			? 'dirty'
			: 'clean'
		: 'never-committed';
	const cloudBackupState = options.syncContext
		? await deriveEntityCloudBackupState(
				db,
				options.syncContext,
				{ entityType: 'collation', entityId: collationId },
				base.currentCheckpoint,
				dirtyToCheckpoint
			)
		: base.cloudBackupState;

	return {
		...base,
		workingContentHash,
		dirtyToCheckpoint,
		commitState,
		cloudBackupState,
	};
}

export async function listProjectCollationVersionStatusesWithWorkingFiles(
	db: Kysely<Database>,
	projectId: string,
	options: CollationVersionStatusOptions = {},
	storeOptions: StoreOperationOptions = {}
): Promise<CollationVersionStatus[]> {
	const rows = await db
		.selectFrom('collations')
		.select('id')
		.where('project_id', '=', projectId)
		.orderBy('updated_at', 'desc')
		.execute();
	return Promise.all(
		rows.map(row =>
			getCollationVersionStatusWithWorkingFile(
				db,
				requireString(row.id, 'collation id'),
				options,
				storeOptions
			)
		)
	);
}

async function loadCollationFileContext(
	db: Kysely<Database>,
	collationId: string
): Promise<CollationFileContext> {
	const row = await db
		.selectFrom('collations')
		.innerJoin('projects', 'projects.id', 'collations.project_id')
		.select([
			'collations.project_id as project_id',
			'projects.storage_slug as project_storage_slug',
			'collations.current_revision_id as current_revision_id',
			'collations.current_content_hash as current_content_hash',
			'collations.created_at as created_at',
			'collations.updated_at as updated_at',
		])
		.where('collations.id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);
	return {
		collationId,
		projectId: requireString(row.project_id, 'project id'),
		projectStorageSlug: requireString(row.project_storage_slug, 'project storage slug'),
		currentRevisionId: emptyToNull(row.current_revision_id),
		currentContentHash: emptyToNull(row.current_content_hash),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function loadCollationCommitSource(
	db: Kysely<Database>,
	context: CollationFileContext,
	storeOptions: StoreOperationOptions
): Promise<CollationCommitSource> {
	const workingPayload = await tryReadWorkingCollationPayload(context, storeOptions);
	if (workingPayload) {
		return {
			collation: serializedCollationFromWorkingPayload(workingPayload),
			createdAt: workingPayload.created_at,
			updatedAt: workingPayload.updated_at,
		};
	}
	return {
		collation: await loadSerializedCollation(db, context.collationId),
		createdAt: context.createdAt,
		updatedAt: context.updatedAt,
	};
}

async function writeSealedJsonFile<
	TPayload extends Record<string, JsonValue>,
	TFormat extends string,
>(
	path: string,
	format: TFormat,
	schemaVersion: number,
	payload: TPayload,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const document = await sealDocument(format, schemaVersion, payload);
	await writeTextFileAtomic(path, serializeSealedDocument(document), storeOptions);
}

async function writeDerivedCollationTei(
	projectStorageSlug: string,
	collationId: string,
	payload: CollationPayload,
	storeOptions: StoreOperationOptions
): Promise<void> {
	try {
		const artifact = payload.artifacts.find(row => row.artifact_type === 'collation_document_v1');
		const document = parseCollationDocument(artifact?.payload ?? null);
		if (!document) throw new Error('Collation document artifact is missing or invalid.');
		await writeTextFileAtomic(
			collationTeiFile(projectStorageSlug, collationId),
			collationDocumentToTei(document),
			storeOptions
		);
	} catch (error) {
		console.warn('[document-store] Could not write derived collation TEI.', {
			collationId,
			error: errorMessage(error),
		});
	}
}

async function assertFileMissing(
	path: string,
	storeOptions: StoreOperationOptions
): Promise<void> {
	try {
		await readTextFile(path, storeOptions);
	} catch (error) {
		if (isMissingFileError(error)) return;
		throw error;
	}
	throw new Error(`Refusing to overwrite existing history file ${path}.`);
}

function buildWorkingCollationPayload(
	collation: SerializedCollation,
	context: CollationFileContext,
	input: {
		artifactId: string;
		artifactType: string;
		artifactPayload: JsonValue;
		updatedAt: string;
	}
): WorkingCollationPayload {
	return {
		id: collation.id,
		project_id: collation.project_id,
		title: collation.title,
		verse_identifier: collation.verse_identifier,
		status: inferWorkflowStatus(input.artifactType, input.artifactPayload) ?? collation.status,
		group_path: collation.group_path,
		notes: collation.notes,
		sort_key: collation.sort_key,
		created_at: context.createdAt,
		updated_at: input.updatedAt,
		witnesses: collation.witnesses.map(row => ({
			...row,
		})) as WorkingCollationPayload['witnesses'],
		tokens: collation.tokens.map(row => ({ ...row })) as WorkingCollationPayload['tokens'],
		variation_units: collation.variation_units.map(row => ({
			...row,
		})) as WorkingCollationPayload['variation_units'],
		readings: collation.readings.map(row => ({ ...row })) as WorkingCollationPayload['readings'],
		reading_witnesses: collation.reading_witnesses.map(row => ({
			...row,
		})) as WorkingCollationPayload['reading_witnesses'],
		artifacts: replaceArtifact(collation.artifacts, {
			id: input.artifactId,
			artifact_type: input.artifactType,
			payload: input.artifactPayload,
		}),
		draft: {
			base_revision_id: context.currentRevisionId,
			base_content_hash: context.currentContentHash,
			saved_at: input.updatedAt,
			author_name: null,
		},
	};
}

async function tryReadWorkingCollationPayload(
	context: CollationFileContext,
	storeOptions: StoreOperationOptions
): Promise<LoadedWorkingCollationPayload | null> {
	const path = collationWorkingFile(context.projectStorageSlug, context.collationId);
	let raw: string;
	try {
		raw = await readTextFile(path, storeOptions);
	} catch (error) {
		if (!isMissingFileError(error)) {
			console.warn('[document-store] Falling back to collation index cache.', {
				path,
				error: errorMessage(error),
			});
		}
		return null;
	}
	const result = await readCanonicalDocument<WorkingCollationPayload>(WORKING_COLLATION_FORMAT, raw);
	if (result.ok) {
		const payload = result.payload as unknown as LoadedWorkingCollationPayload;
		if (payload.id !== context.collationId) {
			console.warn('[document-store] Ignoring mismatched collation working file.', {
				path,
				expectedCollationId: context.collationId,
				actualCollationId: payload.id,
			});
			return null;
		}
		return payload;
	}
	console.warn('[document-store] Ignoring unreadable collation working file.', {
		path,
		quarantine: result.quarantine,
	});
	return null;
}

function loadedCollationFromWorkingPayload(
	loaded: LoadedCollation,
	payload: LoadedWorkingCollationPayload
): LoadedCollation {
	const artifact = payload.artifacts.find(row => row.artifact_type === 'collation_document_v1');
	return {
		row: {
			...loaded.row,
			projectId: payload.project_id,
			title: payload.title,
			verseIdentifier: payload.verse_identifier,
			status: payload.status,
			groupPath: payload.group_path,
			notes: payload.notes,
			sortKey: payload.sort_key,
			createdAt: payload.created_at,
			updatedAt: payload.updated_at,
		},
		artifact: artifact ? artifactRecordFromWorkingPayload(artifact, payload.updated_at) : null,
		legacyArtifact: null,
		projection: projectionFromWorkingPayload(payload),
	};
}

function serializedCollationFromWorkingPayload(payload: LoadedWorkingCollationPayload): SerializedCollation {
	return {
		id: payload.id,
		project_id: payload.project_id,
		title: payload.title,
		verse_identifier: payload.verse_identifier,
		status: payload.status,
		group_path: payload.group_path,
		notes: payload.notes,
		sort_key: payload.sort_key,
		witnesses: payload.witnesses,
		tokens: payload.tokens,
		variation_units: payload.variation_units,
		readings: payload.readings,
		reading_witnesses: payload.reading_witnesses,
		artifacts: payload.artifacts,
	};
}

function artifactRecordFromWorkingPayload(
	artifact: LoadedWorkingCollationArtifact,
	updatedAt: string
): CollationArtifactRecord {
	return {
		id: artifact.id,
		artifactType: artifact.artifact_type,
		payload: JSON.stringify(artifact.payload),
		createdAt: updatedAt,
	};
}

function projectionFromWorkingPayload(payload: LoadedWorkingCollationPayload): CollationProjectionRecord {
	const readingsByUnitId = groupBy(payload.readings, row => row.variation_unit_id);
	const witnessIdsByReadingId = groupBy(payload.reading_witnesses, row => row.reading_id);
	return {
		witnesses: [...payload.witnesses]
			.sort(
				(left, right) =>
					left.position - right.position || left.witness_id.localeCompare(right.witness_id)
			)
			.map(row => ({
				witnessId: row.witness_id,
				transcriptionId: row.transcription_id,
				sourceVersion: row.source_revision_id,
				content: row.content,
				position: row.position,
			})),
		tokens: [...payload.tokens]
			.sort(
				(left, right) =>
					left.witness_id.localeCompare(right.witness_id) ||
					left.token_index - right.token_index
			)
			.map(row => ({
				witnessId: row.witness_id,
				tokenIndex: row.token_index,
				tokenText: row.token_text,
			})),
		variationUnits: [...payload.variation_units]
			.sort(
				(left, right) =>
					left.start_index - right.start_index || left.end_index - right.end_index
			)
			.map(unit => ({
				id: unit.id,
				startIndex: unit.start_index,
				endIndex: unit.end_index,
				unitType: unit.unit_type,
				baseText: unit.base_text,
				readings: [...(readingsByUnitId.get(unit.id) ?? [])]
					.sort((left, right) => left.reading_order - right.reading_order)
					.map(reading => ({
						id: reading.id,
						readingOrder: reading.reading_order,
						readingText: reading.reading_text,
						isOmission: reading.is_omission,
						isLacuna: reading.is_lacuna,
						witnessIds: (witnessIdsByReadingId.get(reading.id) ?? []).map(
							row => row.witness_id
						),
					})),
			})),
	};
}

function replaceArtifact(
	artifacts: SerializedCollationArtifact[],
	nextArtifact: LoadedWorkingCollationArtifact
): LoadedWorkingCollationArtifact[] {
	return [
		...artifacts
			.filter(row => row.artifact_type !== nextArtifact.artifact_type)
			.map(row => ({
				id: row.id,
				artifact_type: row.artifact_type,
				payload: toJsonValue(row.payload, `collation artifact ${row.id}`),
			})),
		nextArtifact,
	];
}

function inferWorkflowStatus(artifactType: string, artifactPayload: JsonValue): string | null {
	if (artifactType !== 'collation_document_v1' || !isJsonObject(artifactPayload)) return null;
	const flow = artifactPayload.flow;
	if (!isJsonObject(flow) || typeof flow.phase !== 'string') return null;
	return flow.phase === 'stemma' ? 'complete' : flow.phase;
}

function parseJsonValue(value: string, label: string): JsonValue {
	try {
		return toJsonValue(JSON.parse(value), label);
	} catch (error) {
		throw new Error(`Invalid JSON in ${label}: ${errorMessage(error)}`);
	}
}

function toJsonValue(value: unknown, label: string): JsonValue {
	if (value === null) return null;
	if (typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) => toJsonValue(entry, `${label}[${index}]`));
	}
	if (typeof value === 'object') {
		const record: JsonObject = {};
		for (const [key, entry] of Object.entries(value)) {
			record[key] = toJsonValue(entry, `${label}.${key}`);
		}
		return record;
	}
	throw new Error(`${label} contains unsupported JSON value ${String(value)}.`);
}

function isJsonObject(value: JsonValue): value is JsonObject {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function emptyToNull(value: string | null): string | null {
	return value?.trim() ? value : null;
}

function requireString(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label}.`);
	return value;
}

function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isMissingFileError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return /not found/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
