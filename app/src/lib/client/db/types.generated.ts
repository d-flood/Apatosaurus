export interface Database {
	collation_artifacts: CollationArtifacts;
	collation_reading_witnesses: CollationReadingWitnesses;
	collation_readings: CollationReadings;
	collation_tokens: CollationTokens;
	collation_variation_units: CollationVariationUnits;
	collation_witnesses: CollationWitnesses;
	collations: Collations;
	iiif_canvas_annotations: IiifCanvasAnnotations;
	iiif_manifest_sources: IiifManifestSources;
	project_transcriptions: ProjectTranscriptions;
	projects: Projects;
	schema_migrations: SchemaMigrations;
	transcription_page_canvas_links: TranscriptionPageCanvasLinks;
	transcription_verse_index: TranscriptionVerseIndex;
	transcriptions: Transcriptions;
}

export interface CollationArtifacts {
	id: string | null;
	collation_id: string;
	artifact_type: string;
	payload: string;
	created_at: string;
}

export interface CollationReadingWitnesses {
	id: string | null;
	reading_id: string;
	witness_id: string;
}

export interface CollationReadings {
	id: string | null;
	variation_unit_id: string;
	reading_order: number;
	reading_text: string;
	is_lacuna: number;
	is_omission: number;
}

export interface CollationTokens {
	id: string | null;
	collation_id: string;
	witness_id: string;
	token_index: number;
	token_text: string;
}

export interface CollationVariationUnits {
	id: string | null;
	collation_id: string;
	start_index: number;
	end_index: number;
	unit_type: string;
	base_text: string;
}

export interface CollationWitnesses {
	id: string | null;
	collation_id: string;
	witness_id: string;
	content: string;
	position: number;
	source_version: string;
	transcription_id: string | null;
}

export interface Collations {
	id: string | null;
	project_id: string | null;
	title: string;
	verse_identifier: string;
	status: string;
	group_path: string;
	notes: string;
	sort_key: number;
	created_at: string;
	updated_at: string;
}

export interface IiifCanvasAnnotations {
	id: string | null;
	transcription_id: string;
	manifest_source_id: string;
	canvas_id: string;
	page_id: string | null;
	annotation_id: string;
	annotation_kind: string | null;
	body_json: string;
	target_json: string;
	anchor_json: string;
	motivation: string;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface IiifManifestSources {
	id: string | null;
	transcription_id: string;
	manifest_url: string;
	label: string;
	source_kind: string;
	default_canvas_id: string | null;
	default_image_service_url: string | null;
	metadata_json: string;
	created_at: string;
	updated_at: string;
}

export interface ProjectTranscriptions {
	id: string | null;
	project_id: string;
	transcription_id: string;
	added_at: string;
	added_by_id: number | null;
}

export interface Projects {
	id: string | null;
	name: string;
	description: string;
	charter: string;
	collation_settings: string;
	owner_id: number | null;
	created_at: string;
	updated_at: string;
}

export interface SchemaMigrations {
	version: number | null;
	name: string;
	applied_at: string;
}

export interface TranscriptionPageCanvasLinks {
	id: string | null;
	transcription_id: string;
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
	created_at: string;
	updated_at: string;
}

export interface TranscriptionVerseIndex {
	id: string | null;
	transcription_id: string;
	verse_identifier: string;
	book: string;
	chapter: string;
	verse: string;
	last_indexed_at: string;
}

export interface Transcriptions {
	id: string | null;
	title: string;
	siglum: string;
	description: string;
	content_json: string;
	format: string;
	created_at: string;
	updated_at: string;
	owner: string | null;
	is_public: number;
	tags: string;
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
}

