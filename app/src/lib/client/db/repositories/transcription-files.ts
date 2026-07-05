import type { Kysely } from 'kysely';

import {
	coerceTranscriptionDocument,
	EMPTY_TRANSCRIPTION_DOC,
	serializeTranscriptionDocument,
	TRANSCRIPTION_FORMAT,
	type StoredTranscriptionDocument,
} from '$lib/client/transcription/content';
import {
	readCanonicalDocument,
	readTextFile,
	sealDocument,
	serializeSealedDocument,
	transcriptionWorkingFile,
	WORKING_TRANSCRIPTION_CURRENT_VERSION,
	WORKING_TRANSCRIPTION_FORMAT,
	writeTextFileAtomic,
	type JsonValue,
	type StoreOperationOptions,
	type WorkingTranscriptionPayload,
} from '$lib/client/store';

import type { Database } from '../types.generated';
import { loadProjectTranscriptionSnapshot } from './revisions';
import {
	getTranscription,
	updateTranscriptionContent,
	type TranscriptionRecord,
	type UpdateTranscriptionContentInput,
} from './transcriptions';

interface TranscriptionFileContext {
	transcriptionId: string;
	projectTranscriptionId: string;
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
		page_canvas_links: [...snapshot.page_canvas_links],
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
			'projects.storage_slug as project_storage_slug',
			'transcriptions.current_revision_id as current_revision_id',
			'transcriptions.current_content_hash as current_content_hash',
			'transcriptions.origin_type as origin_type',
			'transcriptions.origin_project_id as origin_project_id',
			'transcriptions.origin_transcription_id as origin_transcription_id',
			'transcriptions.origin_revision_id as origin_revision_id',
			'transcriptions.origin_content_hash as origin_content_hash',
			'transcriptions.created_at as created_at',
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
	};
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

function isMissingFileError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return /not found/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
