import type { Kysely } from 'kysely';

import {
	coerceTranscriptionDocument,
	EMPTY_TRANSCRIPTION_DOC,
	serializeTranscriptionDocument,
	TRANSCRIPTION_FORMAT,
	type StoredTranscriptionDocument,
} from '$lib/client/transcription/content';
import {
	PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FORMAT,
	TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	assertProjectTranscriptionRevisionHash,
	readCanonicalDocument,
	readTextFile,
	sealDocument,
	serializeSealedDocument,
	transcriptionCheckpointFile,
	transcriptionDocumentToTei,
	transcriptionPrimaryFile,
	transcriptionTeiFile,
	transcriptionWorkingFile,
	WORKING_TRANSCRIPTION_CURRENT_VERSION,
	WORKING_TRANSCRIPTION_FORMAT,
	writeTextFileAtomic,
	type JsonValue,
	type ProjectTranscriptionPayload,
	type StoreOperationOptions,
	type TranscriptionCheckpointPayload as CanonicalTranscriptionCheckpointPayload,
	type WorkingTranscriptionPayload,
} from '$lib/client/store';

import type { Database } from '../types.generated';
import { writeProjectManifestFile } from './project-files';
import {
	buildTranscriptionHashPayload,
	createCommittedTranscriptionCheckpoint,
	hashCanonicalPayload,
	loadProjectTranscriptionSnapshot,
	type CommitTranscriptionInput,
	type TranscriptionCheckpoint,
} from './revisions';
import {
	createTranscription,
	createTranscriptions,
	getTranscription,
	updateTranscriptionContent,
	type CreateTranscriptionInput,
	type TranscriptionRecord,
	type UpdateTranscriptionContentInput,
} from './transcriptions';

interface TranscriptionFileContext {
	transcriptionId: string;
	projectTranscriptionId: string;
	projectId: string;
	projectStorageSlug: string;
	canonicalTranscriptionId: string | null;
	currentRevisionId: string | null;
	currentContentHash: string | null;
	originType: string;
	originProjectId: string | null;
	originTranscriptionId: string | null;
	originRevisionId: string | null;
	originContentHash: string | null;
	createdAt: string;
	updatedAt: string;
}

interface LoadedWorkingTranscriptionPayload {
	origin: {
		source_type: string;
		source_project_id: string | null;
		source_transcription_id: string | null;
		source_revision_id: string | null;
		source_content_hash: string | null;
	};
	title: string;
	siglum: string;
	description: string;
	content_json: JsonValue;
	content_format: string;
	updated_at: string;
	owner: string | null;
	is_public: boolean;
	tags: string[];
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
}

export async function saveWorkingTranscriptionContent(
	db: Kysely<Database>,
	input: UpdateTranscriptionContentInput,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const contentJson = normalizeContentJson(getContentJson(input), input.id);
	const updatedAt = input.updatedAt ?? new Date().toISOString();
	const context = await loadTranscriptionFileContext(db, input.id);
	const snapshot = await loadProjectTranscriptionSnapshot(db, context.projectTranscriptionId);
	const contentFormat = input.format ?? snapshot.format ?? TRANSCRIPTION_FORMAT;
	const payload = {
		project_transcription_id: snapshot.project_transcription_id,
		id: snapshot.id,
		canonical_transcription_id: context.canonicalTranscriptionId,
		origin: {
			source_type: context.originType,
			source_project_id: context.originProjectId,
			source_transcription_id: context.originTranscriptionId,
			source_revision_id: context.originRevisionId,
			source_content_hash: context.originContentHash,
		},
		title: snapshot.title,
		siglum: snapshot.siglum,
		description: snapshot.description,
		content_json: parseJsonValue(contentJson, `transcription ${input.id} content_json`),
		content_format: contentFormat,
		created_at: context.createdAt,
		updated_at: updatedAt,
		owner: snapshot.owner,
		is_public: snapshot.is_public,
		tags: [...snapshot.tags],
		transcriber: snapshot.transcriber,
		repository: snapshot.repository,
		settlement: snapshot.settlement,
		language: snapshot.language,
		iiif_manifest_sources: snapshot.iiif_manifest_sources.map(source => ({
			...source,
			metadata_json: source.metadata_json as JsonValue,
		})),
		page_canvas_links: snapshot.page_canvas_links.map(link => ({
			id: link.id,
			page_id: link.page_id,
			page_name_snapshot: link.page_name_snapshot,
			page_order: link.page_order,
			manifest_source_id: link.manifest_source_id,
			manifest_url_snapshot: link.manifest_url_snapshot,
			canvas_id: link.canvas_id,
			canvas_order: link.canvas_order,
			canvas_label: link.canvas_label,
			image_service_url: link.image_service_url,
			thumbnail_url: link.thumbnail_url,
			link_role: link.link_role,
		})),
		canvas_annotations: snapshot.canvas_annotations.map(annotation => ({
			...annotation,
			body_json: annotation.body_json as JsonValue,
			target_json: annotation.target_json as JsonValue,
			anchor_json: annotation.anchor_json as JsonValue,
		})),
		draft: {
			base_revision_id: context.currentRevisionId,
			base_content_hash: context.currentContentHash,
			saved_at: updatedAt,
			author_name: null,
		},
	};
	const document = await sealDocument(
		WORKING_TRANSCRIPTION_FORMAT,
		WORKING_TRANSCRIPTION_CURRENT_VERSION,
		payload as unknown as WorkingTranscriptionPayload
	);

	await writeTextFileAtomic(
		transcriptionWorkingFile(context.projectStorageSlug, context.projectTranscriptionId),
		serializeSealedDocument(document),
		storeOptions
	);
	await updateTranscriptionContent(db, {
		id: input.id,
		contentJson,
		format: contentFormat,
		updatedAt,
	});
}

export async function createTranscriptionWithFiles(
	db: Kysely<Database>,
	input: CreateTranscriptionInput,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const ids = await createTranscriptionsWithFiles(db, [input], storeOptions);
	return ids[0];
}

export async function createTranscriptionsWithFiles(
	db: Kysely<Database>,
	inputs: CreateTranscriptionInput[],
	storeOptions: StoreOperationOptions = {}
): Promise<string[]> {
	const ids = await createTranscriptions(db, inputs);
	for (const id of ids) {
		const context = await loadTranscriptionFileContext(db, id);
		await createCommittedTranscriptionCheckpointWithFiles(
			db,
			{
				projectTranscriptionId: context.projectTranscriptionId,
				createdAt: context.createdAt,
			},
			storeOptions
		);
	}
	return ids;
}

export async function createCommittedTranscriptionCheckpointWithFiles(
	db: Kysely<Database>,
	input: CommitTranscriptionInput,
	storeOptions: StoreOperationOptions = {}
): Promise<TranscriptionCheckpoint> {
	const context = await loadTranscriptionFileContextByProjectTranscriptionId(
		db,
		input.projectTranscriptionId
	);
	const snapshot = await loadProjectTranscriptionSnapshot(db, input.projectTranscriptionId);
	const payload = buildTranscriptionHashPayload(snapshot);
	const contentHash = await hashCanonicalPayload(payload);
	const checkpointId = input.checkpointId ?? createId();
	const createdAt = input.createdAt ?? new Date().toISOString();
	const authorName = input.authorName ?? '';
	const commitMessage = input.commitMessage ?? null;
	const checkpointPayload: CanonicalTranscriptionCheckpointPayload = {
		checkpoint_id: checkpointId,
		entity_type: 'project-transcription',
		entity_id: snapshot.project_transcription_id,
		payload_transcription_id: snapshot.id,
		parent_checkpoint_id: context.currentRevisionId,
		payload_content_hash: contentHash,
		content_format: snapshot.format,
		commit_message: commitMessage,
		author_name: authorName,
		created_at: createdAt,
		payload: payload as JsonValue,
	};
	const checkpointPath = transcriptionCheckpointFile(
		context.projectStorageSlug,
		context.projectTranscriptionId,
		checkpointId
	);
	await assertFileMissing(checkpointPath, storeOptions);
	await writeSealedJsonFile(
		checkpointPath,
		TRANSCRIPTION_CHECKPOINT_FORMAT,
		TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
		checkpointPayload,
		storeOptions
	);

	const primaryPayload: ProjectTranscriptionPayload = {
		project_transcription_id: snapshot.project_transcription_id,
		id: snapshot.id,
		canonical_transcription_id: context.canonicalTranscriptionId,
		current_revision: {
			id: checkpointId,
			content_hash: contentHash,
			created_at: createdAt,
			author_name: authorName,
		},
		origin: {
			source_type: context.originType,
			source_project_id: context.originProjectId,
			source_transcription_id: context.originTranscriptionId,
			source_revision_id: context.originRevisionId,
			source_content_hash: context.originContentHash,
		},
		title: snapshot.title,
		siglum: snapshot.siglum,
		description: snapshot.description,
		content_json: snapshot.content_json as JsonValue,
		content_format: snapshot.format,
		created_at: context.createdAt,
		updated_at: context.updatedAt,
		owner: snapshot.owner,
		is_public: snapshot.is_public,
		tags: [...snapshot.tags],
		transcriber: snapshot.transcriber,
		repository: snapshot.repository,
		settlement: snapshot.settlement,
		language: snapshot.language,
		iiif_manifest_sources: snapshot.iiif_manifest_sources.map(source => ({
			...source,
			metadata_json: source.metadata_json as JsonValue,
		})),
		page_canvas_links: snapshot.page_canvas_links.map(link => ({
			id: link.id,
			page_id: link.page_id,
			page_name_snapshot: link.page_name_snapshot,
			page_order: link.page_order,
			manifest_source_id: link.manifest_source_id,
			manifest_url_snapshot: link.manifest_url_snapshot,
			canvas_id: link.canvas_id,
			canvas_order: link.canvas_order,
			canvas_label: link.canvas_label,
			image_service_url: link.image_service_url,
			thumbnail_url: link.thumbnail_url,
			link_role: link.link_role,
		})),
		canvas_annotations: snapshot.canvas_annotations.map(annotation => ({
			...annotation,
			body_json: annotation.body_json as JsonValue,
			target_json: annotation.target_json as JsonValue,
			anchor_json: annotation.anchor_json as JsonValue,
		})),
	};
	await assertProjectTranscriptionRevisionHash(primaryPayload);
	await writeSealedJsonFile(
		transcriptionPrimaryFile(context.projectStorageSlug, context.projectTranscriptionId),
		PROJECT_TRANSCRIPTION_FORMAT,
		PROJECT_TRANSCRIPTION_CURRENT_VERSION,
		primaryPayload,
		storeOptions
	);
	await writeDerivedTranscriptionTei(
		context.projectStorageSlug,
		context.projectTranscriptionId,
		primaryPayload,
		storeOptions
	);
	await writeProjectManifestFile(
		db,
		context.projectId,
		{
			transcriptions: {
				[context.projectTranscriptionId]: { id: checkpointId, content_hash: contentHash },
			},
		},
		storeOptions
	);

	return createCommittedTranscriptionCheckpoint(db, {
		...input,
		checkpointId,
		createdAt,
		authorName,
		commitMessage,
	});
}

export async function loadTranscriptionWithWorkingFile(
	db: Kysely<Database>,
	transcriptionId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<TranscriptionRecord | null> {
	const record = await getTranscription(db, transcriptionId);
	if (!record) return null;
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	const payload = await tryReadWorkingTranscriptionPayload(context, storeOptions);
	if (!payload) return record;
	return {
		...record,
		origin_type: payload.origin.source_type,
		origin_project_id: payload.origin.source_project_id,
		origin_transcription_id: payload.origin.source_transcription_id,
		origin_revision_id: payload.origin.source_revision_id ?? '',
		origin_content_hash: payload.origin.source_content_hash ?? '',
		title: payload.title,
		siglum: payload.siglum,
		description: payload.description,
		content_json: JSON.stringify(payload.content_json),
		format: payload.content_format,
		updated_at: payload.updated_at,
		owner: payload.owner,
		is_public: payload.is_public,
		tags: [...payload.tags],
		transcriber: payload.transcriber,
		repository: payload.repository,
		settlement: payload.settlement,
		language: payload.language,
	};
}

async function tryReadWorkingTranscriptionPayload(
	context: TranscriptionFileContext,
	storeOptions: StoreOperationOptions
): Promise<LoadedWorkingTranscriptionPayload | null> {
	const path = transcriptionWorkingFile(context.projectStorageSlug, context.projectTranscriptionId);
	let raw: string;
	try {
		raw = await readTextFile(path, storeOptions);
	} catch (error) {
		if (!isMissingFileError(error)) {
			console.warn('[document-store] Falling back to transcription index cache.', {
				path,
				error: errorMessage(error),
			});
		}
		return null;
	}
	const result = await readCanonicalDocument<WorkingTranscriptionPayload>(
		WORKING_TRANSCRIPTION_FORMAT,
		raw
	);
	if (result.ok) {
		const payload = result.payload as unknown as LoadedWorkingTranscriptionPayload & {
			id: string;
			project_transcription_id: string;
		};
		if (
			payload.id !== context.transcriptionId ||
			payload.project_transcription_id !== context.projectTranscriptionId
		) {
			console.warn('[document-store] Ignoring mismatched transcription working file.', {
				path,
				expectedTranscriptionId: context.transcriptionId,
				actualTranscriptionId: payload.id,
				expectedProjectTranscriptionId: context.projectTranscriptionId,
				actualProjectTranscriptionId: payload.project_transcription_id,
			});
			return null;
		}
		return payload;
	}
	console.warn('[document-store] Ignoring unreadable transcription working file.', {
		path,
		quarantine: result.quarantine,
	});
	return null;
}

async function loadTranscriptionFileContext(
	db: Kysely<Database>,
	transcriptionId: string
): Promise<TranscriptionFileContext> {
	const row = await db
		.selectFrom('transcriptions')
		.innerJoin('project_transcriptions', join =>
			join
				.onRef('project_transcriptions.transcription_id', '=', 'transcriptions.id')
				.onRef('project_transcriptions.project_id', '=', 'transcriptions.project_id')
		)
		.innerJoin('projects', 'projects.id', 'transcriptions.project_id')
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
			'transcriptions.project_id as project_id',
			'projects.storage_slug as project_storage_slug',
			'transcriptions.current_revision_id as current_revision_id',
			'transcriptions.current_content_hash as current_content_hash',
			'transcriptions.origin_type as origin_type',
			'transcriptions.origin_project_id as origin_project_id',
			'transcriptions.origin_transcription_id as origin_transcription_id',
			'transcriptions.origin_revision_id as origin_revision_id',
			'transcriptions.origin_content_hash as origin_content_hash',
			'transcriptions.created_at as created_at',
			'transcriptions.updated_at as updated_at',
		])
		.where('transcriptions.id', '=', transcriptionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Transcription ${transcriptionId} was not found.`);
	return {
		transcriptionId,
		projectTranscriptionId: requireString(
			row.project_transcription_id,
			'project transcription id'
		),
		projectId: row.project_id,
		projectStorageSlug: requireString(row.project_storage_slug, 'project storage slug'),
		canonicalTranscriptionId: row.canonical_transcription_id,
		currentRevisionId: emptyToNull(row.current_revision_id),
		currentContentHash: emptyToNull(row.current_content_hash),
		originType: row.origin_type,
		originProjectId: row.origin_project_id,
		originTranscriptionId: row.origin_transcription_id,
		originRevisionId: emptyToNull(row.origin_revision_id),
		originContentHash: emptyToNull(row.origin_content_hash),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function loadTranscriptionFileContextByProjectTranscriptionId(
	db: Kysely<Database>,
	projectTranscriptionId: string
): Promise<TranscriptionFileContext> {
	const row = await db
		.selectFrom('project_transcriptions')
		.select(['transcription_id'])
		.where('id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Project transcription ${projectTranscriptionId} was not found.`);
	return loadTranscriptionFileContext(db, row.transcription_id);
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

async function writeDerivedTranscriptionTei(
	projectStorageSlug: string,
	projectTranscriptionId: string,
	payload: ProjectTranscriptionPayload,
	storeOptions: StoreOperationOptions
): Promise<void> {
	try {
		await writeTextFileAtomic(
			transcriptionTeiFile(projectStorageSlug, projectTranscriptionId),
			transcriptionDocumentToTei(payload),
			storeOptions
		);
	} catch (error) {
		console.warn('[document-store] Could not write derived transcription TEI.', {
			projectTranscriptionId,
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

function getContentJson(input: {
	contentJson?: string;
	document?: StoredTranscriptionDocument | null;
}): string {
	if (input.contentJson) return input.contentJson;
	return serializeTranscriptionDocument(input.document || EMPTY_TRANSCRIPTION_DOC);
}

function normalizeContentJson(contentJson: string, transcriptionId: string): string {
	const document = coerceTranscriptionDocument(contentJson);
	if (!document) throw new Error(`Transcription ${transcriptionId} content is missing or invalid.`);
	return serializeTranscriptionDocument(document);
}

function parseJsonValue(value: string, label: string): JsonValue {
	try {
		return JSON.parse(value) as JsonValue;
	} catch (error) {
		throw new Error(`Invalid JSON in ${label}: ${errorMessage(error)}`);
	}
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
