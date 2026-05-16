PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcriptions (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	siglum TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	content_json TEXT NOT NULL,
	format TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	owner TEXT,
	is_public INTEGER NOT NULL DEFAULT 0,
	tags TEXT NOT NULL DEFAULT '[]',
	transcriber TEXT NOT NULL DEFAULT '',
	repository TEXT NOT NULL DEFAULT '',
	settlement TEXT NOT NULL DEFAULT '',
	language TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_updated_at ON transcriptions(updated_at DESC);

CREATE TABLE IF NOT EXISTS transcription_verse_index (
	id TEXT PRIMARY KEY,
	transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
	verse_identifier TEXT NOT NULL,
	book TEXT NOT NULL DEFAULT '',
	chapter TEXT NOT NULL DEFAULT '',
	verse TEXT NOT NULL DEFAULT '',
	last_indexed_at TEXT NOT NULL,
	UNIQUE(transcription_id, verse_identifier)
);

CREATE INDEX IF NOT EXISTS idx_transcription_verse_index_transcription_id ON transcription_verse_index(transcription_id);
CREATE INDEX IF NOT EXISTS idx_transcription_verse_index_verse_identifier ON transcription_verse_index(verse_identifier, transcription_id);

CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	charter TEXT NOT NULL DEFAULT '',
	collation_settings TEXT NOT NULL DEFAULT '{}',
	owner_id INTEGER,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);

CREATE TABLE IF NOT EXISTS project_transcriptions (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
	added_at TEXT NOT NULL,
	added_by_id INTEGER,
	UNIQUE(project_id, transcription_id)
);

CREATE INDEX IF NOT EXISTS idx_project_transcriptions_project_id ON project_transcriptions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_transcriptions_transcription_id ON project_transcriptions(transcription_id);

CREATE TABLE IF NOT EXISTS collations (
	id TEXT PRIMARY KEY,
	project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
	title TEXT NOT NULL,
	verse_identifier TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'draft',
	group_path TEXT NOT NULL DEFAULT '',
	notes TEXT NOT NULL DEFAULT '',
	sort_key INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collations_updated_at ON collations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_collations_project_id ON collations(project_id);

CREATE TABLE IF NOT EXISTS collation_artifacts (
	id TEXT PRIMARY KEY,
	collation_id TEXT NOT NULL REFERENCES collations(id) ON DELETE CASCADE,
	artifact_type TEXT NOT NULL,
	payload TEXT NOT NULL,
	created_at TEXT NOT NULL,
	UNIQUE(collation_id, artifact_type)
);

CREATE TABLE IF NOT EXISTS collation_witnesses (
	id TEXT PRIMARY KEY,
	collation_id TEXT NOT NULL REFERENCES collations(id) ON DELETE CASCADE,
	witness_id TEXT NOT NULL,
	content TEXT NOT NULL DEFAULT '',
	position INTEGER NOT NULL DEFAULT 0,
	source_version TEXT NOT NULL DEFAULT '',
	transcription_id TEXT REFERENCES transcriptions(id) ON DELETE SET NULL,
	UNIQUE(collation_id, witness_id)
);

CREATE TABLE IF NOT EXISTS collation_tokens (
	id TEXT PRIMARY KEY,
	collation_id TEXT NOT NULL REFERENCES collations(id) ON DELETE CASCADE,
	witness_id TEXT NOT NULL,
	token_index INTEGER NOT NULL,
	token_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collation_tokens_lookup ON collation_tokens(collation_id, witness_id, token_index);

CREATE TABLE IF NOT EXISTS collation_variation_units (
	id TEXT PRIMARY KEY,
	collation_id TEXT NOT NULL REFERENCES collations(id) ON DELETE CASCADE,
	start_index INTEGER NOT NULL,
	end_index INTEGER NOT NULL,
	unit_type TEXT NOT NULL,
	base_text TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_collation_variation_units_span ON collation_variation_units(collation_id, start_index, end_index);

CREATE TABLE IF NOT EXISTS collation_readings (
	id TEXT PRIMARY KEY,
	variation_unit_id TEXT NOT NULL REFERENCES collation_variation_units(id) ON DELETE CASCADE,
	reading_order INTEGER NOT NULL,
	reading_text TEXT NOT NULL,
	is_lacuna INTEGER NOT NULL DEFAULT 0,
	is_omission INTEGER NOT NULL DEFAULT 0,
	UNIQUE(variation_unit_id, reading_order)
);

CREATE TABLE IF NOT EXISTS collation_reading_witnesses (
	id TEXT PRIMARY KEY,
	reading_id TEXT NOT NULL REFERENCES collation_readings(id) ON DELETE CASCADE,
	witness_id TEXT NOT NULL,
	UNIQUE(reading_id, witness_id)
);

CREATE TABLE IF NOT EXISTS iiif_manifest_sources (
	id TEXT PRIMARY KEY,
	transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
	manifest_url TEXT NOT NULL,
	label TEXT NOT NULL,
	source_kind TEXT NOT NULL DEFAULT 'external',
	default_canvas_id TEXT,
	default_image_service_url TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(transcription_id, manifest_url)
);

CREATE TABLE IF NOT EXISTS transcription_page_canvas_links (
	id TEXT PRIMARY KEY,
	transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
	page_id TEXT NOT NULL,
	page_name_snapshot TEXT NOT NULL,
	page_order INTEGER NOT NULL,
	manifest_source_id TEXT NOT NULL REFERENCES iiif_manifest_sources(id) ON DELETE CASCADE,
	manifest_url_snapshot TEXT NOT NULL,
	canvas_id TEXT NOT NULL,
	canvas_order INTEGER NOT NULL,
	canvas_label TEXT NOT NULL,
	image_service_url TEXT,
	thumbnail_url TEXT,
	link_role TEXT NOT NULL DEFAULT 'primary',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(transcription_id, page_id, manifest_source_id, link_role)
);

CREATE INDEX IF NOT EXISTS idx_page_canvas_links_canvas_id ON transcription_page_canvas_links(canvas_id);
CREATE INDEX IF NOT EXISTS idx_page_canvas_links_manifest_source_id ON transcription_page_canvas_links(manifest_source_id);

CREATE TABLE IF NOT EXISTS iiif_canvas_annotations (
	id TEXT PRIMARY KEY,
	transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
	manifest_source_id TEXT NOT NULL REFERENCES iiif_manifest_sources(id) ON DELETE CASCADE,
	canvas_id TEXT NOT NULL,
	page_id TEXT,
	annotation_id TEXT NOT NULL,
	annotation_kind TEXT,
	body_json TEXT NOT NULL,
	target_json TEXT NOT NULL,
	anchor_json TEXT NOT NULL DEFAULT 'null',
	motivation TEXT NOT NULL DEFAULT 'commenting',
	created_by TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(transcription_id, manifest_source_id, annotation_id)
);

CREATE INDEX IF NOT EXISTS idx_canvas_annotations_canvas_id ON iiif_canvas_annotations(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_annotations_page_id ON iiif_canvas_annotations(page_id);
