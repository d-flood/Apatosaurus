import type {
	SerializedIiifCanvasAnnotation,
	SerializedIiifManifestSource,
	SerializedTranscriptionPageCanvasLink,
} from '$lib/db/repositories/revisions';

import type { JsonObject, JsonValue } from '../envelope';
import type { CanonicalCheckpointReference, CanonicalCurrentDraft } from './common';

export type ProjectTranscriptionOrigin = JsonObject & {
	source_type: string;
	source_project_id: string | null;
	source_transcription_id: string | null;
	source_revision_id: string | null;
	source_content_hash: string | null;
	source_captured_at?: string | null;
};

export type CanonicalIiifSyntheticCanvas = JsonObject &
	Omit<SerializedIiifManifestSource['synthetic_canvases'][number], 'metadata'> & {
		metadata: Array<JsonObject & { label: string; value: string }>;
	};

export type CanonicalIiifManifestSource = JsonObject &
	Omit<SerializedIiifManifestSource, 'synthetic_canvases'> & {
		synthetic_canvases: CanonicalIiifSyntheticCanvas[];
	};

export type CanonicalTranscriptionPageCanvasLink = JsonObject &
	SerializedTranscriptionPageCanvasLink;

export type CanonicalIiifCanvasAnnotation = JsonObject &
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
