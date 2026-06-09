# Session 01: Initial Schema and Generated Types

## Goal

Fold the cloud-sync data model directly into `app/src/lib/client/db/migrations/0001_initial.sql`, regenerate database types, and update any immediate compile errors caused by the new table shape.

This is a greenfield change. Do not write migrations or compatibility shims for old development databases unless a separate import tool is explicitly requested.

## Inputs

- `app/src/lib/client/db/migrations/0001_initial.sql`
- `app/src/lib/client/db/types.generated.ts`
- `app/scripts/db/generate-types.ts`
- `app/scripts/db/check-types.ts`

## Implementation Scope

- Add project/global transcription scope and provenance fields to `transcriptions`.
- Make `project_transcriptions.id` the stable project-file identity and point it at a project-owned transcription snapshot row.
- Add app revision and content hash fields to `transcriptions` and `collations`.
- Add exact source revision fields to `collation_witnesses`.
- Add cloud connection, project folder, sync metadata, checkpoint, and tombstone tables.
- Add indexes needed for project lookups, origin lookups, checkpoint history, and sync metadata.
- Regenerate `types.generated.ts` and fix type errors that are direct fallout from renamed or added fields.

## Target Table Shape

Table ordering can be adjusted so foreign keys are valid in the existing initial migration.

```sql
CREATE TABLE transcriptions (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL DEFAULT 'global',
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    origin_type TEXT NOT NULL DEFAULT '',
    origin_project_id TEXT,
    origin_transcription_id TEXT,
    origin_revision_id TEXT NOT NULL DEFAULT '',
    origin_content_hash TEXT NOT NULL DEFAULT '',
    current_revision_id TEXT NOT NULL DEFAULT '',
    current_content_hash TEXT NOT NULL DEFAULT '',
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

CREATE INDEX idx_transcriptions_scope ON transcriptions(scope_type, project_id, updated_at DESC);
CREATE INDEX idx_transcriptions_origin ON transcriptions(origin_transcription_id, origin_revision_id);

CREATE TABLE project_transcriptions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
    canonical_transcription_id TEXT,
    added_at TEXT NOT NULL,
    added_by_id INTEGER,
    UNIQUE(project_id, transcription_id)
);

CREATE INDEX idx_project_transcriptions_project_id ON project_transcriptions(project_id);
CREATE INDEX idx_project_transcriptions_transcription_id ON project_transcriptions(transcription_id);
CREATE INDEX idx_project_transcriptions_canonical ON project_transcriptions(canonical_transcription_id);

CREATE TABLE collations (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    current_revision_id TEXT NOT NULL DEFAULT '',
    current_content_hash TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    verse_identifier TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    group_path TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    sort_key INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE collation_witnesses (
    id TEXT PRIMARY KEY,
    collation_id TEXT NOT NULL REFERENCES collations(id) ON DELETE CASCADE,
    witness_id TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    project_transcription_id TEXT REFERENCES project_transcriptions(id) ON DELETE SET NULL,
    transcription_id TEXT REFERENCES transcriptions(id) ON DELETE SET NULL,
    source_revision_id TEXT NOT NULL DEFAULT '',
    source_content_hash TEXT NOT NULL DEFAULT '',
    UNIQUE(collation_id, witness_id)
);

CREATE TABLE cloud_connections (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    provider_account_id TEXT NOT NULL DEFAULT '',
    account_email TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER,
    connected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider_id, provider_account_id)
);

CREATE TABLE cloud_project_folders (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES cloud_connections(id) ON DELETE RESTRICT,
    cloud_folder_id TEXT NOT NULL,
    cloud_folder_path TEXT NOT NULL,
    sync_cursor TEXT NOT NULL DEFAULT '',
    last_fully_synced_at TEXT
);

CREATE TABLE cloud_sync_metadata (
    connection_id TEXT NOT NULL REFERENCES cloud_connections(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    cloud_file_id TEXT NOT NULL,
    cloud_path TEXT NOT NULL,
    last_synced_revision TEXT NOT NULL,
    last_synced_hash TEXT NOT NULL,
    last_synced_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, scope_type, scope_id, entity_type, entity_id)
);

CREATE INDEX idx_cloud_sync_metadata_scope ON cloud_sync_metadata(scope_type, scope_id);
CREATE INDEX idx_cloud_sync_metadata_path ON cloud_sync_metadata(connection_id, cloud_path);

CREATE TABLE transcription_checkpoints (
    id TEXT PRIMARY KEY,
    transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
    parent_checkpoint_id TEXT REFERENCES transcription_checkpoints(id) ON DELETE SET NULL,
    format TEXT NOT NULL,
    payload TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    is_committed INTEGER NOT NULL DEFAULT 0,
    commit_message TEXT,
    author_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_transcription_checkpoints_lookup ON transcription_checkpoints(transcription_id, created_at DESC);
CREATE INDEX idx_transcription_checkpoints_committed ON transcription_checkpoints(transcription_id, is_committed, created_at DESC);

CREATE TABLE collation_checkpoints (
    id TEXT PRIMARY KEY,
    collation_id TEXT NOT NULL REFERENCES collations(id) ON DELETE CASCADE,
    parent_checkpoint_id TEXT REFERENCES collation_checkpoints(id) ON DELETE SET NULL,
    payload TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    is_committed INTEGER NOT NULL DEFAULT 0,
    commit_message TEXT,
    author_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_collation_checkpoints_lookup ON collation_checkpoints(collation_id, created_at DESC);
CREATE INDEX idx_collation_checkpoints_committed ON collation_checkpoints(collation_id, is_committed, created_at DESC);

CREATE TABLE sync_tombstones (
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
```

## Rules

- Global/canonical transcriptions use `scope_type = 'global'` and `project_id = null`.
- Project-owned snapshots use `scope_type = 'project_snapshot'` and set `project_id`.
- Library queries must filter for global transcriptions.
- Project workflows must use `project_transcriptions.id` as the project file identity and `project_transcriptions.transcription_id` as the editable snapshot row.
- `current_revision_id` and `current_content_hash` can be empty for entities that have never been committed.
- Cloud tokens are stored locally because the app is static. Do not log token fields.

## Acceptance Criteria

- A fresh database can be created from `0001_initial.sql` without migration errors.
- `app/src/lib/client/db/types.generated.ts` reflects the new schema.
- Existing code compiles or has only follow-up errors that belong to later session scopes and are documented.
- No old-schema compatibility code is added.

## Verification

Run from `app/`:

```bash
bun run db:generate
bun run db:check
bun run check
```
