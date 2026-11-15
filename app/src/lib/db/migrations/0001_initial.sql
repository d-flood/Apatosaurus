-- Apatosaurus local SQLite index schema.
--
-- This schema is intentionally a disposable index: nothing irreplaceable
-- lives here. All canonical user content lives in OPFS document files
-- (see architecture.md section 4). On startup, if the versioned index
-- file is missing, the index is rebuilt from files and stale index files
-- are deleted (see Phase 6).
--
-- Notes:
--   * This is the current schema for INDEX_SCHEMA_VERSION = 8. Bumping the
--     index version creates a fresh disposable index and rebuilds it from
--     files instead of migrating SQL in place.
--   * `transcriptions.content_json` and `collation_artifacts.payload` are
--     disposable caches: file writes snapshot and hash from them, but content
--     loads read only canonical OPFS files.
--   * Checkpoint tables are metadata-only listings. Payloads live exclusively
--     in canonical history files under OPFS.
--   * `transcriptions.scope_type` (global/project_snapshot) is removed:
--     every transcription is project-owned under the project-only
--     ownership model (architecture.md section 3 decision 1).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	storage_slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	charter TEXT NOT NULL DEFAULT '',
	collation_settings TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);

CREATE TABLE IF NOT EXISTS transcriptions (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	origin_type TEXT NOT NULL DEFAULT '',
	origin_project_id TEXT,
	origin_transcription_id TEXT,
	origin_revision_id TEXT NOT NULL DEFAULT '',
	origin_content_hash TEXT NOT NULL DEFAULT '',
	origin_captured_at TEXT NOT NULL DEFAULT '',
	current_revision_id TEXT NOT NULL DEFAULT '',
	current_content_hash TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL,
	siglum TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	-- Disposable cache: canonical transcription content lives in
	-- `<storage_slug>/transcriptions/<id>.tei.xml`.
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

CREATE INDEX IF NOT EXISTS idx_transcriptions_project_updated
	ON transcriptions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcriptions_origin
	ON transcriptions(origin_transcription_id, origin_revision_id);

CREATE TABLE IF NOT EXISTS transcription_verse_index (
	id TEXT PRIMARY KEY,
	transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
	verse_identifier TEXT NOT NULL,
	book TEXT NOT NULL DEFAULT '',
	chapter TEXT NOT NULL DEFAULT '',
	verse TEXT NOT NULL DEFAULT '',
	last_indexed_at TEXT NOT NULL,
	-- Chunk range of the verse slice in `transcription_slice_chunks`; null when empty.
	slice_first_chunk INTEGER,
	slice_last_chunk INTEGER,
	UNIQUE(transcription_id, verse_identifier)
);

CREATE INDEX IF NOT EXISTS idx_transcription_verse_index_verse_identifier ON transcription_verse_index(verse_identifier, transcription_id);

CREATE TABLE IF NOT EXISTS transcription_verse_index_state (
	transcription_id TEXT PRIMARY KEY REFERENCES transcriptions(id) ON DELETE CASCADE,
	indexed_content_hash TEXT NOT NULL,
	verse_count INTEGER NOT NULL,
	last_indexed_at TEXT NOT NULL,
	-- The document without pages; verse slices supply the pages.
	document_shell_json TEXT NOT NULL DEFAULT '{}',
	hands_json TEXT NOT NULL DEFAULT '[]'
);

-- Deflated runs of `transcriptions.content_json` lines, so gathering a verse
-- inflates the few chunks its slice range covers instead of whole documents.
CREATE TABLE IF NOT EXISTS transcription_slice_chunks (
	transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
	chunk_index INTEGER NOT NULL,
	-- Last 64 bits of the inflated chunk's SHA-256, so saves skip unchanged chunks without inflating them.
	chunk_hash TEXT NOT NULL,
	chunk_deflated BLOB NOT NULL,
	PRIMARY KEY (transcription_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS project_transcriptions (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
	canonical_transcription_id TEXT,
	added_at TEXT NOT NULL,
	UNIQUE(project_id, transcription_id)
);

CREATE INDEX IF NOT EXISTS idx_project_transcriptions_project_id ON project_transcriptions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_transcriptions_transcription_id ON project_transcriptions(transcription_id);
CREATE INDEX IF NOT EXISTS idx_project_transcriptions_canonical ON project_transcriptions(canonical_transcription_id);

CREATE TABLE IF NOT EXISTS collations (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	current_revision_id TEXT NOT NULL DEFAULT '',
	current_content_hash TEXT NOT NULL DEFAULT '',
	title TEXT NOT NULL,
	verse_identifier TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'draft',
	group_path TEXT NOT NULL DEFAULT '',
	notes TEXT NOT NULL DEFAULT '',
	sort_key INTEGER NOT NULL DEFAULT 0,
	conflict_of_collation_id TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collations_updated_at ON collations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_collations_project_id ON collations(project_id);

-- Disposable cache of a collation's Current document, parsed from
-- `<storage_slug>/collations/<id>.tei.xml`.
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
	project_transcription_id TEXT REFERENCES project_transcriptions(id) ON DELETE SET NULL,
	transcription_id TEXT REFERENCES transcriptions(id) ON DELETE SET NULL,
	source_kind TEXT NOT NULL DEFAULT '',
	source_revision_id TEXT NOT NULL DEFAULT '',
	source_content_hash TEXT NOT NULL DEFAULT '',
	source_captured_at TEXT NOT NULL DEFAULT '',
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
	synthetic_canvases_json TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(transcription_id, manifest_url)
);

-- Fetched manifests are provider data, not transcription content; a miss re-fetches.
CREATE TABLE IF NOT EXISTS iiif_manifest_cache (
	manifest_url TEXT PRIMARY KEY,
	metadata_json TEXT NOT NULL,
	fetched_at TEXT NOT NULL
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

-- One row per TEI-canonical file the index was built from or last wrote.
CREATE TABLE IF NOT EXISTS document_file_fingerprints (
	path TEXT PRIMARY KEY,
	entity_type TEXT NOT NULL,
	entity_id TEXT NOT NULL,
	size INTEGER NOT NULL,
	last_modified INTEGER NOT NULL,
	file_hash TEXT NOT NULL,
	content_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_file_fingerprints_entity
	ON document_file_fingerprints(entity_type, entity_id);

-- TEI files that stopped parsing after an outside edit. Size and last_modified
-- belong to the broken file, so an unchanged broken file is not re-read.
CREATE TABLE IF NOT EXISTS document_file_problems (
	path TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	entity_type TEXT NOT NULL,
	entity_id TEXT NOT NULL,
	code TEXT NOT NULL,
	message TEXT NOT NULL,
	size INTEGER NOT NULL,
	last_modified INTEGER NOT NULL,
	detected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_file_problems_project
	ON document_file_problems(project_id);

-- Rebuildable per-file sync cache. The canonical target binding lives in
-- `app/sync-targets.json`; this table only remembers the last successful
-- local/remote fingerprints for cheap mirror comparisons.
CREATE TABLE IF NOT EXISTS sync_file_fingerprints (
	target_id TEXT NOT NULL,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	file_path TEXT NOT NULL,
	local_content_hash TEXT NOT NULL,
	local_size INTEGER NOT NULL,
	local_modified_at TEXT NOT NULL DEFAULT '',
	remote_file_id TEXT NOT NULL,
	remote_revision TEXT NOT NULL,
	remote_content_hash TEXT NOT NULL,
	remote_size INTEGER NOT NULL,
	remote_modified_at TEXT NOT NULL DEFAULT '',
	synced_at TEXT NOT NULL,
	entity_type TEXT NOT NULL DEFAULT '',
	entity_id TEXT NOT NULL DEFAULT '',
	revision_id TEXT NOT NULL DEFAULT '',
	entity_content_hash TEXT NOT NULL DEFAULT '',
	PRIMARY KEY (target_id, project_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_sync_file_fingerprints_project ON sync_file_fingerprints(project_id, target_id);
CREATE INDEX IF NOT EXISTS idx_sync_file_fingerprints_entity ON sync_file_fingerprints(project_id, entity_type, entity_id);

-- Checkpoint listings only. Canonical checkpoint payloads live in
-- history/<kind>s/<id>/<checkpoint>.tei.xml files.
CREATE TABLE IF NOT EXISTS transcription_checkpoints (
	id TEXT PRIMARY KEY,
	transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
	parent_checkpoint_id TEXT REFERENCES transcription_checkpoints(id) ON DELETE SET NULL,
	format TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	is_committed INTEGER NOT NULL DEFAULT 0,
	label TEXT NOT NULL DEFAULT '',
	commit_message TEXT,
	author_name TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transcription_checkpoints_lookup ON transcription_checkpoints(transcription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcription_checkpoints_committed ON transcription_checkpoints(transcription_id, is_committed, created_at DESC);

CREATE TABLE IF NOT EXISTS collation_checkpoints (
	id TEXT PRIMARY KEY,
	collation_id TEXT NOT NULL REFERENCES collations(id) ON DELETE CASCADE,
	parent_checkpoint_id TEXT REFERENCES collation_checkpoints(id) ON DELETE SET NULL,
	content_hash TEXT NOT NULL,
	is_committed INTEGER NOT NULL DEFAULT 0,
	label TEXT NOT NULL DEFAULT '',
	commit_message TEXT,
	author_name TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collation_checkpoints_lookup ON collation_checkpoints(collation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collation_checkpoints_committed ON collation_checkpoints(collation_id, is_committed, created_at DESC);

-- CBGM analysis listings. Canonical metadata lives in
-- `<storage_slug>/cbgm/<id>.json`; the input, cache and global stemma are
-- sibling files there.
CREATE TABLE IF NOT EXISTS cbgm_analyses (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	inputs_frozen_at TEXT NOT NULL,
	completed_at TEXT,
	coherence TEXT NOT NULL,
	global_stemma TEXT NOT NULL,
	collation_ids TEXT NOT NULL DEFAULT '[]',
	witness_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cbgm_analyses_project ON cbgm_analyses(project_id, inputs_frozen_at DESC);

-- Tombstone listings; canonical tombstone files live in OPFS
-- `<storage_slug>/tombstones/` (Phase 5). The index copy is rebuilt
-- from those files on repair.
CREATE TABLE IF NOT EXISTS sync_tombstones (
	id TEXT PRIMARY KEY,
	project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
	entity_type TEXT NOT NULL,
	entity_id TEXT NOT NULL,
	cloud_path TEXT NOT NULL,
	deletion_revision_id TEXT NOT NULL DEFAULT '',
	deleted_by TEXT NOT NULL DEFAULT '',
	deleted_at TEXT NOT NULL,
	UNIQUE(project_id, entity_type, entity_id)
);
