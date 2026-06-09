# Cloud Sync Implementation Sessions

This cloud sync design has been split into session-sized implementation specs. Each numbered file is intended to be completed in one long focused session, with a clear scope, handoff point, and verification checklist.

The sequence assumes Apatosaurus is still greenfield: change the initial schema and current APIs directly rather than adding compatibility shims for old local databases or old cloud JSON formats.

## Session Map

1. [x] [Session 01: Initial Schema and Generated Types](cloud_sync_01_initial_schema.md)
2. [x] [Session 02: Project Transcription Snapshots](cloud_sync_02_project_snapshots.md)
3. [Session 03: Revisions, Hashes, and Checkpoints](cloud_sync_03_revisions_hashes_checkpoints.md)
4. [Session 04: Serialization Formats](cloud_sync_04_serialization_formats.md)
5. [Session 05: Collation Versioning, Tombstones, and Conflicts](cloud_sync_05_collation_tombstones_conflicts.md)
6. [Session 06: Provider Interface, Auth, and Mock Provider](cloud_sync_06_provider_auth_mock.md)
7. [Session 07: Dropbox Provider](cloud_sync_07_dropbox_provider.md)
8. [Session 08: Sync Manager, Polling, and UI States](cloud_sync_08_sync_manager_polling_ui.md)
9. [Session 09: Google Drive Provider](cloud_sync_09_google_drive_provider.md)

## Global Decisions

These decisions apply to every session:

- Use file-level synchronization, not database-file synchronization. Project metadata, project transcription snapshots, collations, checkpoints, and tombstones are separate JSON files.
- A shared project folder must be self-contained. Project transcriptions are project-owned snapshots, not live references to mutable global library transcriptions.
- Local autosave rows are working state. `current_revision_id` and `current_content_hash` describe only the last committed app revision.
- Only committed checkpoints, committed primary entity files, and tombstones are uploaded to cloud storage.
- Never automatically merge transcription or collation data. Preserve both versions and require manual resolution.
- Provider adapters expose provider-specific capabilities and typed errors, but the file format and sync state machine stay provider-neutral.
- Dropbox is the first real provider. Google Drive is intentionally deferred until the Dropbox path and core sync manager are proven.

## Baseline Verification

Use the app workspace for the common checks:

```bash
bun run db:generate
bun run db:check
bun run check
bun run test:unit -- --run
```

Run narrower tests during each session when possible, then run the full baseline before handing off a completed session.
