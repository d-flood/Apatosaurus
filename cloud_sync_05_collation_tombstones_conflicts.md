# Session 05: Collation Versioning, Tombstones, and Conflicts

## Goal

Make collations identify the exact transcription revisions they use, add deletion tombstone behavior, and implement strict no-merge conflict preservation in local code.

This session prepares the data layer for safe collaboration before real cloud sync writes exist.

## Dependencies

- [Session 01](cloud_sync_01_initial_schema.md)
- [Session 03](cloud_sync_03_revisions_hashes_checkpoints.md)
- [Session 04](cloud_sync_04_serialization_formats.md)

## Collation Source Versioning

Collation witnesses must prove exactly which project transcription snapshot revision they used.

Required witness fields:

- `project_transcription_id`
- `transcription_id`
- `source_revision_id`
- `source_content_hash`

When a collation is created or refreshed from project transcription snapshots, copy the current committed revision ID and content hash from each source snapshot. Do not use timestamps or provider file revisions as source identity.

If a source transcription has no committed revision, the collation should either require an initial commit or mark the source revision/hash as empty and treat the collation as not sync-ready.

## Tombstone Rules

Deletion is represented as data, not just missing files.

1. A tombstone wins over an older local or remote entity whose last committed app revision matches or predates the tombstone deletion point.
2. If a remote entity has a committed app revision newer than the tombstone's deletion point, treat it as a delete-vs-edit conflict.
3. If a user deletes an entity offline and another collaborator commits a newer remote edit before the deletion syncs, the later sync must not silently delete the newer edit.
4. If the provider supports expected-revision deletes, use them when deleting the old primary file.
5. If the primary file is already missing, still upload or retain the tombstone as the durable deletion signal.
6. Tombstones should be retained for the life of the project unless a future compaction/export operation rewrites project history intentionally.

## Conflict Strategy

Under no circumstances should Apatosaurus automatically merge transcription or collation data.

Initial copy-preservation strategy:

1. Detect conflict when a committed local head cannot be uploaded because the cloud file revision changed, or when the remote app revision/hash no longer matches the last synced app revision/hash.
2. Download and hash-verify the remote committed version.
3. Apply the remote committed version to the primary local project record only if that is safe for the current local working state.
4. Duplicate the local committed version that failed to upload into a new project-scoped conflict record.
5. Rename the duplicated record with a conflict suffix, such as `03 (Conflicted Copy from User B)`.
6. Preserve local uncommitted autosaves as local draft checkpoints. Never upload them automatically.
7. Notify the user and route them to manual comparison/reconciliation.
8. Do not modify canonical/global transcriptions or another project's snapshots during conflict handling.

## Implementation Scope

- Update collation creation/update code to write source revision/hash fields.
- Add local tombstone creation for project transcription and collation deletes.
- Add tombstone serialization/parsing integration if not completed in Session 04.
- Add conflict-copy creation helpers for project transcriptions and collations.
- Add local draft preservation when a remote committed head would replace a dirty working row.
- Add tests for delete-vs-edit and committed local-vs-remote conflict classification using local/mock data.

## Acceptance Criteria

- Collation witnesses store exact source app revision and hash values.
- Deleting a synced project transcription or collation creates a tombstone record.
- Tombstones are idempotent when applied repeatedly.
- Delete-vs-edit conflicts preserve the newer edit for manual resolution.
- Local uncommitted edits are preserved before a remote committed head replaces the primary row.
- No conflict path automatically merges transcription or collation payloads.

## Verification

Run from `app/`:

```bash
bun run check
bun run test:unit -- --run
```

Add tests for collation source versioning, tombstone precedence, conflict-copy creation, and draft preservation.
