# Session 08: Sync Manager, Polling, and UI States

## Goal

Implement the commit-aware sync manager and the user-visible sync states around local autosave, explicit commits, remote updates, conflicts, and polling.

The sync manager should work against the mock provider first and then the Dropbox provider.

## Dependencies

- [Session 03](cloud_sync_03_revisions_hashes_checkpoints.md)
- [Session 04](cloud_sync_04_serialization_formats.md)
- [Session 05](cloud_sync_05_collation_tombstones_conflicts.md)
- [Session 06](cloud_sync_06_provider_auth_mock.md)
- [Session 07](cloud_sync_07_dropbox_provider.md) for real provider verification

## Local-First Commit Flow

1. Local edits autosave immediately to SQLite working rows.
2. Optional local-only checkpoints can be written with `is_committed = 0`.
3. User chooses Commit Changes.
4. Apatosaurus creates a committed checkpoint with parent checkpoint ID, commit message, author, app revision ID, and content hash.
5. The primary transcription or collation row advances `current_revision_id` and `current_content_hash`.
6. The entity is marked sync pending until cloud writes succeed.
7. Only committed checkpoints, primary committed entity files, and tombstones are uploaded.

## Publish Ordering

Publishing must ensure the primary entity file never points to a missing history checkpoint.

1. Create the committed local checkpoint and compute its content hash.
2. Upload the history checkpoint file first.
3. Confirm the checkpoint upload through the provider write result and metadata lookup when practical.
4. Upload or update the primary project transcription or collation file so `current_revision.id` points to the uploaded checkpoint.
5. Update `cloud_sync_metadata` only after both writes succeed.
6. If checkpoint upload succeeds but primary update conflicts, keep the committed local checkpoint as pending/conflicted and do not delete the history file.

## Bidirectional Sync Algorithm

For each managed project entity:

1. Fetch provider changes through cursor-based listing when available, or recursive listing otherwise.
2. Load local sync metadata and tombstones.
3. Scan local committed heads and dirty working rows.
4. Upload local tombstones and delete remote primary files with expected revision when available.
5. Apply remote tombstones locally if they beat the local entity revision.
6. Create cloud files for committed local-only entities.
7. Download cloud-only files after schema and hash verification.
8. If local and remote app revisions match, update metadata and do nothing destructive.
9. If local committed head changed and remote provider revision still matches metadata, upload checkpoint first and then primary file.
10. If remote committed head changed and there are no local committed changes, download and apply the remote version.
11. If remote committed head changed and local working state is dirty, preserve the local draft and prompt before replacing the working row.
12. If local and remote committed heads both changed, create a manual-resolution conflict.

Before any downloaded transcription, collation, tombstone, or checkpoint is applied, verify `schema_version`, app revision metadata, and content hash. Hash mismatches are quarantined for manual review.

## Open Object Polling

Remote awareness should be targeted to objects the user currently has open.

Polling rules:

- Poll the open project's current transcription snapshot or collation primary file every 30 to 60 seconds while visible and online.
- Poll immediately when the browser window regains focus.
- Poll immediately when the browser comes back online.
- Use provider metadata first.
- Download the primary file only if provider revision/etag differs from `cloud_sync_metadata` or metadata is missing.
- Compare remote `current_revision.id` and `current_revision.content_hash` to the last locally known committed head.
- Back off exponentially on `rate-limited`, `provider-unavailable`, and transient network errors.
- Stop polling and prompt account reconnection on `reauthorization-required`.
- Do not poll every project object continuously during editing.

## UI State Language

Use distinct states so users understand local vs. remote status:

- `saved locally`
- `uncommitted local changes`
- `committed locally`
- `sync pending`
- `synced`
- `remote update available`
- `conflict requires resolution`

## Rollback Behavior

Committed checkpoints form the local history UI. Restoring a previous checkpoint should create a new commit rather than rewriting history.

## Acceptance Criteria

- Manual commit creates a committed checkpoint and queues sync.
- Sync uploads checkpoint files before primary entity files.
- Sync metadata updates only after all required writes succeed.
- Remote files with invalid hashes are quarantined, not applied.
- Remote updates do not overwrite dirty local working rows without preserving a draft.
- Open-object polling detects remote committed heads without full-project polling.
- UI exposes the required sync status language.

## Verification

Run from `app/`:

```bash
bun run check
bun run test:unit -- --run
```

Add mock-provider tests for checkpoint-first publish ordering, primary update conflicts after checkpoint upload, import validation/quarantine, tombstones, local draft preservation, conflict copies, and polling state transitions.
