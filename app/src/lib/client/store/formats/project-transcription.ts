import {
	buildTranscriptionHashPayload,
	type ProjectTranscriptionSnapshot,
	type SerializedIiifCanvasAnnotation,
	type SerializedIiifManifestSource,
	type SerializedTranscriptionPageCanvasLink,
} from '$lib/client/db/repositories/revisions';

import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, JsonValue, SealedDocument } from '../envelope';
import { readCurrentRevision, type CanonicalCurrentRevision } from './common';
import {
	assertContentHashMatches,
	readArray,
	readBoolean,
	readFiniteNumber,
	readJsonValue,
	readLiteral,
	readNullableString,
	readObjectValue,
	readString,
	readStringArray,
} from './validation';

export const PROJECT_TRANSCRIPTION_FORMAT = 'apatosaurus.project-transcription';
export const PROJECT_TRANSCRIPTION_CURRENT_VERSION = 1;
export const projectTranscriptionUpgraders: DocumentUpgrader[] = [];

export type ProjectTranscriptionOrigin = JsonObject & {
	source_type: string;
	source_project_id: string | null;
	source_transcription_id: string | null;
	source_revision_id: string | null;
	source_content_hash: string | null;
};

export type CanonicalIiifManifestSource = JsonObject & Omit<SerializedIiifManifestSource, 'metadata_json'> & {
	metadata_json: JsonValue;
};

export type CanonicalTranscriptionPageCanvasLink = JsonObject & SerializedTranscriptionPageCanvasLink;

export type CanonicalIiifCanvasAnnotation = JsonObject &
	Omit<SerializedIiifCanvasAnnotation, 'body_json' | 'target_json' | 'anchor_json'> & {
		body_json: JsonValue;
		target_json: JsonValue;
		anchor_json: JsonValue;
	};

export type ProjectTranscriptionPayload = JsonObject & {
	project_transcription_id: string;
	id: string;
	scope_type: 'project_snapshot';
	canonical_transcription_id: string | null;
	current_revision: CanonicalCurrentRevision;
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

export type ProjectTranscriptionDocument = SealedDocument<
	ProjectTranscriptionPayload,
	typeof PROJECT_TRANSCRIPTION_FORMAT
>;

export const PROJECT_TRANSCRIPTION_FIXTURE: ProjectTranscriptionPayload = {
	project_transcription_id: 'pt-1',
	id: 'tx-1',
	scope_type: 'project_snapshot',
	canonical_transcription_id: null,
	current_revision: {
		id: 'tx-cp-1',
		content_hash: 'sha256:revision-placeholder',
		created_at: '2026-07-03T00:00:00.000Z',
		author_name: 'Editor',
	},
	origin: {
		source_type: 'created',
		source_project_id: null,
		source_transcription_id: null,
		source_revision_id: null,
		source_content_hash: null,
	},
	title: 'Witness A',
	siglum: 'A',
	description: 'Fixture transcription',
	content_json: { type: 'transcriptionDocument', pages: [] },
	content_format: 'normalized_ast_v3',
	created_at: '2026-07-03T00:00:00.000Z',
	updated_at: '2026-07-03T00:00:00.000Z',
	owner: null,
	is_public: false,
	tags: ['fixture'],
	transcriber: 'Editor',
	repository: 'Repository',
	settlement: 'City',
	language: 'grc',
	iiif_manifest_sources: [
		{
			id: 'manifest-1',
			manifest_url: 'https://example.org/manifest.json',
			label: 'Fixture manifest',
			source_kind: 'iiif',
			default_canvas_id: 'canvas-1',
			default_image_service_url: null,
			metadata_json: { label: 'Fixture manifest' },
		},
	],
	page_canvas_links: [
		{
			id: 'link-1',
			page_id: 'page-1',
			page_name_snapshot: 'Page 1',
			page_order: 1,
			manifest_source_id: 'manifest-1',
			manifest_url_snapshot: 'https://example.org/manifest.json',
			canvas_id: 'canvas-1',
			canvas_order: 1,
			canvas_label: 'Canvas 1',
			image_service_url: null,
			thumbnail_url: null,
			link_role: 'primary',
		},
	],
	canvas_annotations: [
		{
			id: 'annotation-row-1',
			manifest_source_id: 'manifest-1',
			canvas_id: 'canvas-1',
			page_id: 'page-1',
			annotation_id: 'annotation-1',
			annotation_kind: 'comment',
			body_json: { value: 'note' },
			target_json: { source: 'canvas-1' },
			anchor_json: { pageId: 'page-1' },
			motivation: 'commenting',
			created_by: 'editor@example.com',
		},
	],
};

export const PROJECT_TRANSCRIPTION_OLD_SHAPE_FIXTURE = {
	schema_version: 1,
	...PROJECT_TRANSCRIPTION_FIXTURE,
	format: PROJECT_TRANSCRIPTION_FIXTURE.content_format,
};

export function validateProjectTranscriptionPayload(payload: JsonObject): ProjectTranscriptionPayload {
	return readProjectTranscriptionPayload(payload as Record<string, unknown>, true);
}

export function readProjectTranscriptionPayload(
	record: Record<string, unknown>,
	withCurrentRevision: true
): ProjectTranscriptionPayload;
export function readProjectTranscriptionPayload(
	record: Record<string, unknown>,
	withCurrentRevision: false
): Omit<ProjectTranscriptionPayload, 'current_revision'>;
export function readProjectTranscriptionPayload(
	record: Record<string, unknown>,
	withCurrentRevision: boolean
): ProjectTranscriptionPayload | Omit<ProjectTranscriptionPayload, 'current_revision'> {
	const base = {
		project_transcription_id: readString(record, 'project_transcription_id'),
		id: readString(record, 'id'),
		scope_type: readLiteral(record, 'scope_type', 'project_snapshot'),
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
	return withCurrentRevision
		? { current_revision: readCurrentRevision(record, 'current_revision'), ...base }
		: base;
}

export async function assertProjectTranscriptionRevisionHash(
	payload: ProjectTranscriptionPayload
): Promise<void> {
	await assertContentHashMatches(
		buildTranscriptionHashPayload(projectTranscriptionPayloadToSnapshot(payload)),
		payload.current_revision.content_hash,
		`Project transcription ${payload.project_transcription_id}`
	);
}

export function projectTranscriptionPayloadToSnapshot(
	payload: ProjectTranscriptionPayload
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

export const projectTranscriptionFormatRegistration: FormatRegistration<ProjectTranscriptionPayload> = {
	format: PROJECT_TRANSCRIPTION_FORMAT,
	currentVersion: PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	upgraders: projectTranscriptionUpgraders,
	validate: validateProjectTranscriptionPayload,
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
