import {
	buildTranscriptionHashPayload,
	type ProjectTranscriptionSnapshot,
	type SerializedIiifCanvasAnnotation,
	type SerializedIiifManifestSource,
	type SerializedTranscriptionPageCanvasLink,
} from '$lib/db/repositories/revisions';

import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, JsonValue } from '../envelope';
import {
	readCurrentDraft,
	readCurrentRevision,
	readNullableCheckpointReference,
	type CanonicalCheckpointReference,
	type CanonicalCurrentDraft,
	type CanonicalDraftMetadata,
} from './common';
import {
	assertContentHashMatches,
	readArray,
	readBoolean,
	readFiniteNumber,
	readJsonValue,
	readNullableString,
	readObjectValue,
	readString,
	readStringArray,
} from './validation';

export const PROJECT_TRANSCRIPTION_FORMAT = 'apatosaurus.project-transcription';
export const PROJECT_TRANSCRIPTION_CURRENT_VERSION = 2;
const projectTranscriptionUpgraders: DocumentUpgrader[] = [upgradeProjectTranscriptionV1];

type ProjectTranscriptionOrigin = JsonObject & {
	source_type: string;
	source_project_id: string | null;
	source_transcription_id: string | null;
	source_revision_id: string | null;
	source_content_hash: string | null;
	source_captured_at?: string | null;
};

type CanonicalIiifManifestSource = JsonObject &
	Omit<SerializedIiifManifestSource, 'metadata_json'> & {
		metadata_json: JsonValue;
	};

type CanonicalTranscriptionPageCanvasLink = JsonObject & SerializedTranscriptionPageCanvasLink;

type CanonicalIiifCanvasAnnotation = JsonObject &
	Omit<SerializedIiifCanvasAnnotation, 'body_json' | 'target_json' | 'anchor_json'> & {
		body_json: JsonValue;
		target_json: JsonValue;
		anchor_json: JsonValue;
	};

export type ProjectTranscriptionContentPayload = JsonObject & {
	project_transcription_id: string;
	id: string;
	canonical_transcription_id: string | null;
	origin: ProjectTranscriptionOrigin;
	title: string;
	siglum: string;
	description: string;
	content_json: JsonValue;
	content_format: string;
	created_at: string;
	updated_at: string;
	owner: string | null;
	is_public: boolean;
	tags: string[];
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
	iiif_manifest_sources: CanonicalIiifManifestSource[];
	page_canvas_links: CanonicalTranscriptionPageCanvasLink[];
	canvas_annotations: CanonicalIiifCanvasAnnotation[];
};

export type ProjectTranscriptionPayload = ProjectTranscriptionContentPayload & {
	based_on_checkpoint: CanonicalCheckpointReference | null;
	draft: CanonicalCurrentDraft;
};

function validateProjectTranscriptionPayload(payload: JsonObject): ProjectTranscriptionPayload {
	const record = payload as Record<string, unknown>;
	return {
		...readProjectTranscriptionContent(record),
		based_on_checkpoint: readNullableCheckpointReference(record, 'based_on_checkpoint'),
		draft: readCurrentDraft(record, 'draft'),
	};
}

function upgradeProjectTranscriptionV1(payload: JsonObject): JsonObject {
	const { current_revision: _currentRevision, ...content } = payload;
	const revision = readCurrentRevision(payload, 'current_revision');
	return {
		...content,
		based_on_checkpoint: { id: revision.id, content_hash: revision.content_hash },
		draft: { saved_at: readString(payload, 'updated_at'), author_name: null },
	};
}

export function mergeWorkingTranscription(
	primary: ProjectTranscriptionPayload,
	working: ProjectTranscriptionContentPayload & { draft: CanonicalDraftMetadata }
): ProjectTranscriptionPayload {
	const { draft, ...content } = working;
	return {
		...content,
		based_on_checkpoint: primary.based_on_checkpoint,
		draft: { saved_at: draft.saved_at, author_name: draft.author_name },
	};
}

export function readProjectTranscriptionContent(
	record: Record<string, unknown>
): ProjectTranscriptionContentPayload {
	return {
		project_transcription_id: readString(record, 'project_transcription_id'),
		id: readString(record, 'id'),
		canonical_transcription_id: readNullableString(record, 'canonical_transcription_id'),
		origin: readProjectTranscriptionOrigin(record, 'origin'),
		title: readString(record, 'title'),
		siglum: readString(record, 'siglum'),
		description: readString(record, 'description'),
		content_json: readJsonValue(record, 'content_json'),
		content_format: readString(record, 'content_format'),
		created_at: readString(record, 'created_at'),
		updated_at: readString(record, 'updated_at'),
		owner: readNullableString(record, 'owner'),
		is_public: readBoolean(record, 'is_public'),
		tags: readStringArray(record, 'tags'),
		transcriber: readString(record, 'transcriber'),
		repository: readString(record, 'repository'),
		settlement: readString(record, 'settlement'),
		language: readString(record, 'language'),
		iiif_manifest_sources: readManifestSources(record, 'iiif_manifest_sources'),
		page_canvas_links: readPageCanvasLinks(record, 'page_canvas_links'),
		canvas_annotations: readCanvasAnnotations(record, 'canvas_annotations'),
	};
}

async function assertUpgradedProjectTranscriptionHash(
	payload: ProjectTranscriptionPayload,
	originalVersion: number
): Promise<void> {
	if (originalVersion >= PROJECT_TRANSCRIPTION_CURRENT_VERSION) return;
	await assertContentHashMatches(
		buildTranscriptionHashPayload(projectTranscriptionPayloadToSnapshot(payload)),
		payload.based_on_checkpoint?.content_hash ?? '',
		`Project transcription ${payload.project_transcription_id}`
	);
}

export function projectTranscriptionPayloadToSnapshot(
	payload: ProjectTranscriptionContentPayload
): ProjectTranscriptionSnapshot {
	return {
		project_transcription_id: payload.project_transcription_id,
		id: payload.id,
		format: payload.content_format,
		title: payload.title,
		siglum: payload.siglum,
		description: payload.description,
		content_json: payload.content_json,
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

export const projectTranscriptionFormatRegistration: FormatRegistration<ProjectTranscriptionPayload> =
	{
		format: PROJECT_TRANSCRIPTION_FORMAT,
		currentVersion: PROJECT_TRANSCRIPTION_CURRENT_VERSION,
		upgraders: projectTranscriptionUpgraders,
		validate: validateProjectTranscriptionPayload,
		validateIntegrity: assertUpgradedProjectTranscriptionHash,
	};

function readProjectTranscriptionOrigin(
	record: Record<string, unknown>,
	key: string
): ProjectTranscriptionOrigin {
	const origin = readObjectValue(record[key], key);
	return {
		source_type: readString(origin, 'source_type'),
		source_project_id: readNullableString(origin, 'source_project_id'),
		source_transcription_id: readNullableString(origin, 'source_transcription_id'),
		source_revision_id: readNullableString(origin, 'source_revision_id'),
		source_content_hash: readNullableString(origin, 'source_content_hash'),
		...(origin.source_captured_at === undefined
			? {}
			: { source_captured_at: readNullableString(origin, 'source_captured_at') }),
	};
}

function readManifestSources(
	record: Record<string, unknown>,
	key: string
): CanonicalIiifManifestSource[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			id: readString(row, 'id'),
			manifest_url: readString(row, 'manifest_url'),
			label: readString(row, 'label'),
			source_kind: readString(row, 'source_kind'),
			default_canvas_id: readNullableString(row, 'default_canvas_id'),
			default_image_service_url: readNullableString(row, 'default_image_service_url'),
			metadata_json: readJsonValue(row, 'metadata_json'),
		};
	});
}

function readPageCanvasLinks(
	record: Record<string, unknown>,
	key: string
): CanonicalTranscriptionPageCanvasLink[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			id: readString(row, 'id'),
			page_id: readString(row, 'page_id'),
			page_name_snapshot: readString(row, 'page_name_snapshot'),
			page_order: readFiniteNumber(row, 'page_order'),
			manifest_source_id: readString(row, 'manifest_source_id'),
			manifest_url_snapshot: readString(row, 'manifest_url_snapshot'),
			canvas_id: readString(row, 'canvas_id'),
			canvas_order: readFiniteNumber(row, 'canvas_order'),
			canvas_label: readString(row, 'canvas_label'),
			image_service_url: readNullableString(row, 'image_service_url'),
			thumbnail_url: readNullableString(row, 'thumbnail_url'),
			link_role: readString(row, 'link_role'),
		};
	});
}

function readCanvasAnnotations(
	record: Record<string, unknown>,
	key: string
): CanonicalIiifCanvasAnnotation[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			id: readString(row, 'id'),
			manifest_source_id: readString(row, 'manifest_source_id'),
			canvas_id: readString(row, 'canvas_id'),
			page_id: readNullableString(row, 'page_id'),
			annotation_id: readString(row, 'annotation_id'),
			annotation_kind: readNullableString(row, 'annotation_kind'),
			body_json: readJsonValue(row, 'body_json'),
			target_json: readJsonValue(row, 'target_json'),
			anchor_json: readJsonValue(row, 'anchor_json'),
			motivation: readString(row, 'motivation'),
			created_by: readNullableString(row, 'created_by'),
		};
	});
}
