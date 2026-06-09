# Session 04: Serialization Formats

## Goal

Implement deterministic JSON serialization and parsing for project cloud folders.

This session should produce local code that can dump and load project metadata, project transcription snapshots, collations, committed history files, and tombstones without needing a real cloud provider.

## Dependencies

- [Session 01](cloud_sync_01_initial_schema.md)
- [Session 02](cloud_sync_02_project_snapshots.md)
- [Session 03](cloud_sync_03_revisions_hashes_checkpoints.md)

## Folder Layout

Project folders use stable IDs, not mutable display names.

```text
/Apatosaurus/Projects/[Project_ID]/
+-- project.json
+-- transcriptions/
|   +-- [ProjectTranscription_ID_1].json
|   +-- [ProjectTranscription_ID_2].json
+-- collations/
|   +-- [Collation_ID_1].json
|   +-- [Collation_ID_2].json
+-- history/
|   +-- transcriptions/
|   |   +-- [ProjectTranscription_ID]/[Checkpoint_ID].json
|   +-- collations/
|       +-- [Collation_ID]/[Checkpoint_ID].json
+-- tombstones/
    +-- [Tombstone_ID].json
```

Dropbox may use paths as provider IDs. Google Drive will use immutable file IDs. The Apatosaurus project-relative paths still stay deterministic.

## `project.json`

Contains project metadata from the `projects` table.

```json
{
  "schema_version": 1,
  "id": "project-uuid-1234",
  "name": "Gospel of John Collation",
  "description": "Collation of John Chapter 18 witnesses",
  "charter": "Project charter text...",
  "collation_settings": {
    "normalization": true,
    "regularize": false
  },
  "created_at": "2026-06-08T12:00:00Z",
  "updated_at": "2026-06-08T12:00:00Z"
}
```

## `transcriptions/[project_transcription_id].json`

Contains the project-owned transcription snapshot, project link/provenance metadata, IIIF manifest sources, page canvas links, and canvas annotations.

```json
{
  "schema_version": 1,
  "project_transcription_id": "project-transcription-uuid-2222",
  "id": "transcription-snapshot-uuid-5678",
  "scope_type": "project_snapshot",
  "canonical_transcription_id": "canonical-transcription-uuid-1234",
  "current_revision": {
    "id": "checkpoint-uuid-34",
    "content_hash": "sha256:5f6d...",
    "created_at": "2026-06-08T12:05:00Z",
    "author_name": "David Flood"
  },
  "origin": {
    "source_type": "canonical",
    "source_project_id": null,
    "source_transcription_id": "canonical-transcription-uuid-1234",
    "source_revision_id": "checkpoint-uuid-12",
    "source_content_hash": "sha256:91ab..."
  },
  "title": "Codex Vaticanus - John 18",
  "siglum": "03",
  "description": "Transcription from IIIF images",
  "content_json": { "type": "doc", "content": [] },
  "format": "normalized_ast_v3",
  "created_at": "2026-06-08T12:00:00Z",
  "updated_at": "2026-06-08T12:05:00Z",
  "owner": "user@example.com",
  "is_public": 0,
  "tags": ["vaticanus", "john"],
  "transcriber": "David Flood",
  "repository": "Vatican Library",
  "settlement": "Vatican City",
  "language": "grc",
  "iiif_manifest_sources": [],
  "page_canvas_links": [],
  "canvas_annotations": []
}
```

## `collations/[id].json`

Contains collation metadata and all child records needed to reconstruct the collation.

```json
{
  "schema_version": 1,
  "id": "collation-uuid-9999",
  "project_id": "project-uuid-1234",
  "title": "John 18:1 Collation",
  "verse_identifier": "B04K18V1",
  "status": "draft",
  "current_revision": {
    "id": "collation-checkpoint-uuid-55",
    "content_hash": "sha256:77aa...",
    "created_at": "2026-06-08T12:10:00Z",
    "author_name": "David Flood"
  },
  "group_path": "",
  "notes": "Discussion on spelling variations...",
  "sort_key": 1,
  "created_at": "2026-06-08T12:00:00Z",
  "updated_at": "2026-06-08T12:10:00Z",
  "witnesses": [
    {
      "id": "witness-uuid-1",
      "witness_id": "01",
      "content": "Greek text...",
      "position": 1,
      "project_transcription_id": "project-transcription-uuid-2222",
      "transcription_id": "transcription-snapshot-uuid-5678",
      "source_revision_id": "checkpoint-uuid-34",
      "source_content_hash": "sha256:5f6d..."
    }
  ],
  "tokens": [],
  "variation_units": [],
  "artifacts": []
}
```

## `history/.../[checkpoint_id].json`

Committed history files are immutable application checkpoints and are the audit trail for rollback, comparison, and remote import.

```json
{
  "schema_version": 1,
  "checkpoint_id": "checkpoint-uuid-34",
  "entity_type": "project-transcription",
  "entity_id": "project-transcription-uuid-2222",
  "payload_transcription_id": "transcription-snapshot-uuid-5678",
  "parent_checkpoint_id": "checkpoint-uuid-12",
  "content_hash": "sha256:5f6d...",
  "format": "normalized_ast_v3",
  "commit_message": "Fixed typo in John 18:3",
  "author_name": "David Flood",
  "created_at": "2026-06-08T12:05:00Z",
  "payload": {
    "title": "Codex Vaticanus - John 18",
    "siglum": "03",
    "content_json": { "type": "doc", "content": [] }
  }
}
```

Collation history files use the same envelope with `entity_type = "collation"`, `entity_id = [Collation_ID]`, and the serialized collation payload.

## `tombstones/[tombstone_id].json`

Tombstones are synced deletion records that prevent deleted entities from being recreated by another client that still has an old local copy.

```json
{
  "schema_version": 1,
  "id": "tombstone-uuid-1",
  "project_id": "project-uuid-1234",
  "entity_type": "project-transcription",
  "entity_id": "project-transcription-uuid-2222",
  "cloud_path": "transcriptions/project-transcription-uuid-2222.json",
  "deletion_revision_id": "checkpoint-uuid-90",
  "deleted_by": "user@example.com",
  "deleted_at": "2026-06-08T12:30:00Z"
}
```

## Implementation Scope

- Add TypeScript types for every serialized file shape.
- Add serializers from SQLite/repository records to JSON objects.
- Add parsers/validators from JSON objects back to repository inputs.
- Verify `schema_version` before import.
- Verify primary entity `current_revision.content_hash` and checkpoint `content_hash` before applying downloaded data.
- Quarantine invalid or hash-mismatched files instead of applying them.
- Round-trip IIIF manifest sources, page canvas links, canvas annotations, collation children, history files, and tombstones.

## Acceptance Criteria

- Project metadata round-trips through JSON.
- Project transcription snapshots round-trip with IIIF records and provenance.
- Collations round-trip with witnesses, tokens, variation units, readings, reading witnesses, and artifacts.
- Checkpoints and primary entity files compute matching content hashes for the same committed revision.
- Invalid schema versions and hash mismatches are rejected or quarantined.

## Verification

Run from `app/`:

```bash
bun run check
bun run test:unit -- --run
```

Add serialization round-trip tests and import validation tests.
