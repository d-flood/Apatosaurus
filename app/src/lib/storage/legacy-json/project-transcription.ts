import type { ProjectTranscriptionSnapshot } from '$lib/db/repositories/revisions';

import { isSyntheticManifestUrl, syntheticCanvasesFromManifest } from '$lib/iiif/syntheticManifest';

import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, JsonValue } from '../envelope';
import {
	readCurrentDraft,
	readCurrentRevision,
	readNullableCheckpointReference,
	type CanonicalDraftMetadata,
} from '../formats/common';
import type {
	CanonicalIiifCanvasAnnotation,
	CanonicalIiifManifestSource,
	CanonicalIiifSyntheticCanvas,
	CanonicalTranscriptionPageCanvasLink,
	ProjectTranscriptionContentPayload,
	ProjectTranscriptionOrigin,
	ProjectTranscriptionPayload,
} from '../formats/project-transcription';
import { buildTranscriptionHashPayload } from './legacy-hash';
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
} from '../formats/validation';

export const PROJECT_TRANSCRIPTION_FORMAT = 'apatosaurus.project-transcription';
export const PROJECT_TRANSCRIPTION_CURRENT_VERSION = 3;
const projectTranscriptionUpgraders: DocumentUpgrader[] = [
	upgradeProjectTranscriptionV1,
	upgradeLegacyIiifManifestSources,
];

function validateProjectTranscriptionPayload(payload: JsonObject): ProjectTranscriptionPayload {
	const record = payload as Record<string, unknown>;
	return {
		...readProjectTranscriptionContent(record),
		based_on_checkpoint: readNullableCheckpointReference(record, 'based_on_checkpoint'),
		draft: readCurrentDraft(record, 'draft'),
	};
}

// Checks the v1 hash here because it covers manifest JSON that the v3 upgrade drops.
async function upgradeProjectTranscriptionV1(payload: JsonObject): Promise<JsonObject> {
	const { current_revision: _currentRevision, ...content } = payload;
	const revision = readCurrentRevision(payload, 'current_revision');
	await assertContentHashMatches(
		legacyTranscriptionHashPayload(payload),
		revision.content_hash,
		`Project transcription ${readString(payload, 'project_transcription_id')}`
	);
	return {
		...content,
		based_on_checkpoint: { id: revision.id, content_hash: revision.content_hash },
		draft: { saved_at: readString(payload, 'updated_at'), author_name: null },
	};
}

export function upgradeLegacyIiifManifestSources(payload: JsonObject): JsonObject {
	const sources = payload.iiif_manifest_sources;
	if (!Array.isArray(sources)) return payload;
	return { ...payload, iiif_manifest_sources: sources.map(upgradeLegacyManifestSource) };
}

function upgradeLegacyManifestSource(entry: JsonValue): JsonValue {
	if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
	const { metadata_json: metadata, ...source } = entry;
	if (source.synthetic_canvases !== undefined) return source;
	const manifestJson =
		metadata && typeof metadata === 'object' && !Array.isArray(metadata)
			? metadata.manifestJson
			: null;
	const synthetic =
		typeof source.manifest_url === 'string' &&
		isSyntheticManifestUrl(source.manifest_url) &&
		manifestJson &&
		typeof manifestJson === 'object' &&
		!Array.isArray(manifestJson);
	return {
		...source,
		synthetic_canvases: synthetic
			? (syntheticCanvasesFromManifest(manifestJson) as unknown as JsonValue)
			: [],
	};
}

function legacyTranscriptionHashPayload(payload: JsonObject): unknown {
	const content = readProjectTranscriptionContent(upgradeLegacyIiifManifestSources(payload));
	const hashPayload = buildTranscriptionHashPayload(
		projectTranscriptionPayloadToSnapshot(content)
	);
	const rows = readArray(payload, 'iiif_manifest_sources');
	if (rows.some(entry => (entry as JsonObject)?.metadata_json === undefined)) return hashPayload;
	const legacySources = rows.map((entry, index) => {
		const row = readObjectValue(entry, `iiif_manifest_sources[${index}]`);
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
	return {
		...(hashPayload as object),
		iiif_manifest_sources: legacySources.sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0
		),
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
		const row = readObjectValue(
			upgradeLegacyManifestSource(entry as JsonValue),
			`${key}[${index}]`
		);
		return {
			id: readString(row, 'id'),
			manifest_url: readString(row, 'manifest_url'),
			label: readString(row, 'label'),
			source_kind: readString(row, 'source_kind'),
			default_canvas_id: readNullableString(row, 'default_canvas_id'),
			default_image_service_url: readNullableString(row, 'default_image_service_url'),
			synthetic_canvases: readArray(row, 'synthetic_canvases').map((canvas, canvasIndex) =>
				readSyntheticCanvas(canvas, `${key}[${index}].synthetic_canvases[${canvasIndex}]`)
			),
		};
	});
}

function readSyntheticCanvas(entry: unknown, label: string): CanonicalIiifSyntheticCanvas {
	const canvas = readObjectValue(entry, label);
	return {
		canvas_id: readString(canvas, 'canvas_id'),
		label: readString(canvas, 'label'),
		width: readFiniteNumber(canvas, 'width'),
		height: readFiniteNumber(canvas, 'height'),
		image_url: readString(canvas, 'image_url'),
		thumbnail_url: readNullableString(canvas, 'thumbnail_url'),
		metadata: readArray(canvas, 'metadata').map((item, itemIndex) => {
			const row = readObjectValue(item, `${label}.metadata[${itemIndex}]`);
			return { label: readString(row, 'label'), value: readString(row, 'value') };
		}),
	};
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
