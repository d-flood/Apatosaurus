import type { Kysely } from 'kysely';

import {
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
	type StoreOperationOptions,
	type WorkingCollationPayload,
} from '$lib/client/store';
import { hashCanonicalPayload } from '$lib/client/sync/canonical-json';
import { deriveEntityCloudBackupState } from '$lib/client/sync/backup-status';

import type { Database } from '../types.generated';
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
	loadSerializedCollation,
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
	projectStorageSlug: string;
	currentRevisionId: string | null;
	currentContentHash: string | null;
	createdAt: string;
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
			'projects.storage_slug as project_storage_slug',
			'collations.current_revision_id as current_revision_id',
			'collations.current_content_hash as current_content_hash',
			'collations.created_at as created_at',
		])
		.where('collations.id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);
	return {
		collationId,
		projectStorageSlug: requireString(row.project_storage_slug, 'project storage slug'),
		currentRevisionId: emptyToNull(row.current_revision_id),
		currentContentHash: emptyToNull(row.current_content_hash),
		createdAt: row.created_at,
	};
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

function isMissingFileError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return /not found/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
