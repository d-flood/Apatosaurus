# Subplan 6: Cloud Project Browser and Local Sync/Restore

## Selection Rationale

This subplan follows intentional backup because restore should consume the same project-contained cloud layout that backup produces. The app already has cloud file parsers and import-shape conversion helpers, but it needs a browser/orchestrator that can discover cloud project folders, validate them, and import them into the OPFS SQLite database in a safe dependency order.

## Goal

Let users browse valid cloud project folders, import them into the local OPFS database, and opt into pulling remote updates for already linked projects.

After this subplan, users should be able to:

- Browse provider folders containing valid `project.json` files.
- See cloud projects as not local, already linked, conflicting with local, or quarantined.
- Import a cloud project into an empty or existing local database.
- Link a cloud project folder to an existing local project when identities match or user confirms.
- Open an already linked local project.
- See when a linked remote project manifest has newer committed entity heads.
- Pull remote updates only after explicit confirmation.
- Preserve remote IDs and cloud file metadata to avoid duplicate uploads after restore.

## Non-Goals

- Do not add a second project file format.
- Do not import library/global transcriptions outside project folders.
- Do not silently overwrite conflicting local projects.
- Do not silently pull remote updates in the background.
- Do not implement full conflict resolution for concurrent edits; assume only one device/person updates a project at a time and show a conservative warning if local and remote both changed.
- Do not implement local filesystem provider. That belongs to Subplan 7, though this browser should work with it later.
- Do not implement safe local removal. That belongs to Subplan 8.

## Current Grounding

### Existing Cloud Layout and Parsers

Cloud file parsing exists in `app/src/lib/client/sync/cloud-files.ts`:

- `parseProjectCloudFile`
- `parseProjectTranscriptionCloudFile`
- `parseCollationCloudFile`
- `parseHistoryCloudFile`
- `parseTombstoneCloudFile`

Import-shape conversion helpers exist:

- `projectCloudFileToRepositoryInput`
- `projectTranscriptionCloudFileToImportInput`
- `collationCloudFileToImportInput`
- `historyCloudFileToImportInput`
- `tombstoneCloudFileToRow`

What is missing:

- Repository write orchestration for full project import.
- Cloud folder discovery/classification.
- Remote manifest polling and head comparison for linked projects.
- User-confirmed project pull orchestration.
- Sync metadata preservation during import.
- UI for browsing/importing/linking.

### Existing Sync Apply Helpers

`sync-manager.ts` has internal remote-apply helpers:

- `applyProjectTranscriptionPrimary`
- `applyCollationPrimary`
- `insertRemoteCheckpoint`

These are currently internal to open-entity sync flows. Restore needs similar behavior at project scale, likely as exported/import-layer functions or a new restore module.

### Existing Provider Interface

`CloudStorageProvider` supports:

- `listFiles(folderId, { recursive, cursor })`
- `downloadFile(fileId)`
- `createFile`
- `updateFile`
- `deleteFile`

The browser can use recursive listing where supported by provider implementations. Current providers emulate or implement recursive listing.

## Product Semantics

### Cloud Project Folder

A cloud project folder is valid when it contains a parseable `project.json` at its root and uses the expected project-contained layout.

Minimum valid folder:

- `project.json`

Complete restorable folder may also contain:

- `transcriptions/*.json`
- `collations/*.json`
- `history/...`
- `tombstones/*.json`

The `project.json` manifest should include current committed heads for project transcriptions, collations, and tombstones. Browser/import/polling should use that manifest as the first source of remote version information before downloading entity primary files.

### Classification

Each discovered cloud project should be classified as:

- `not-local`: no local project with matching ID.
- `already-linked`: local project exists and `cloud_project_folders` links it to this connection/folder.
- `local-same-id-unlinked`: local project exists with same ID but no folder link.
- `local-conflict`: local project exists with same ID but appears divergent or linked elsewhere.
- `quarantined`: project file or required files are invalid.
- `unavailable`: provider could not read enough data.

### Import

Import means writing cloud project data into local SQLite while preserving cloud identities.

Rules:

- Preserve project ID.
- Preserve project transcription link IDs.
- Preserve project-owned transcription row IDs when the cloud primary contains them. If ID preservation is impossible, preserve `project_transcriptions.id` and maintain correct links/witnesses.
- Preserve collation IDs.
- Preserve checkpoint IDs.
- Preserve cloud file IDs/revisions in `cloud_sync_metadata` where available.
- Preserve project folder link in `cloud_project_folders`.
- Do not duplicate uploads immediately after restore.

### Pull Remote Updates

Pull means applying newer committed heads from a linked remote project folder into the local project after user confirmation.

Rules:

- Polling checks only the remote `project.json` manifest by default.
- Pull downloads the changed entity primaries, referenced history files, and tombstones required by the manifest.
- Pull applies remote committed heads to local project transcriptions and collations.
- Pull should be blocked or require high-friction confirmation if local working state has uncommitted changes.
- If both local committed head and remote manifest head differ from the last synced head, classify as diverged/conflict and do not auto-merge.

## Browser Flow

### Discovery

1. User opens cloud project browser.
2. User selects provider connection.
3. Browser lists candidate project folders under `Apatosaurus/Projects` or configured root.
4. Browser looks for `project.json` in each candidate folder.
5. Browser downloads and parses `project.json`.
6. Browser classifies each cloud project against local database.
7. Browser displays valid, linked, conflicting, and quarantined entries.

### Import

1. User chooses `Sync locally` for a `not-local` cloud project.
2. Browser downloads project manifest and all relevant JSON files.
3. Import orchestrator validates all primary/history relationships.
4. Import writes project data in dependency order.
5. Import records `cloud_project_folders` and `cloud_sync_metadata`.
6. UI opens the imported project.

### Pull Linked Project

1. Poller or user action downloads linked remote `project.json`.
2. App compares manifest entity heads to local committed heads and `cloud_sync_metadata` last-synced heads.
3. If remote has newer heads and local has no uncommitted or diverged state, UI shows `Remote update available`.
4. User chooses `Pull remote updates`.
5. App downloads changed primary/history/tombstone files.
6. App validates hashes and primary/history relationships.
7. App applies project metadata, project transcription updates, collation updates, tombstones, and sync metadata in a transaction where feasible.
8. UI reloads the project and shows updated local state.

### Link Existing

1. User chooses `Link to local project` for a cloud project with same ID or selected local project.
2. UI shows local and cloud project summaries.
3. User confirms link if safe.
4. App writes `cloud_project_folders`.
5. App may optionally run a dry-run comparison before enabling backup.

## Import Dependency Order

Use this order:

1. Project metadata from `project.json`.
2. Project transcription primaries from `transcriptions/*.json`.
3. Transcription history from `history/transcriptions/**.json`.
4. Collation primaries from `collations/*.json`.
5. Collation history from `history/collations/**.json`.
6. Tombstones from `tombstones/*.json`.
7. Cloud project folder link.
8. Cloud sync metadata.

Reasoning:

- Collations reference project transcription witnesses.
- Checkpoints reference entity IDs and payload IDs.
- Sync metadata should only be written after local rows exist.

## Repository and Service Plan

### New Restore Module

Create a dedicated restore/import module:

- `app/src/lib/client/sync/project-restore.ts`

Recommended types:

```ts
export interface CloudProjectCandidate {
	connectionId: string;
	folderId: string;
	folderPath: string;
	projectId: string;
	name: string;
	description: string;
	updatedAt: string;
	classification: CloudProjectClassification;
	quarantines: SyncQuarantine[];
}

export interface ImportCloudProjectInput {
	connectionId: string;
	folderId: string;
	folderPath: string;
	mode: 'create-local' | 'link-existing' | 'replace-local-after-confirmation';
	localProjectId?: string;
}
```

Recommended functions:

- `listCloudProjectCandidates(db, provider, connectionId, rootFolderId)`
- `classifyCloudProjectCandidate(db, candidate)`
- `importCloudProject(db, provider, input)`
- `linkCloudProjectFolder(db, input)`
- `dryRunCloudProjectImport(db, provider, input)`
- `pollLinkedProjectManifest(db, provider, context)`
- `compareRemoteManifestToLocalProject(db, manifest, context)`
- `pullLinkedProjectUpdates(db, provider, context, options?)`

### Repository Write Helpers

Add import functions close to the relevant repositories or in the restore module:

- `importProjectTranscriptionPrimary`
- `importTranscriptionCheckpoint`
- `importCollationPrimary`
- `importCollationCheckpoint`
- `importTombstone`
- `upsertCloudSyncMetadataFromRemoteFile`

Implementation notes:

- Prefer transactions per project import.
- If the transaction becomes too large for OPFS/SQLite performance, stage parsed files then write in batches with clear rollback strategy.
- Use existing conversion helpers from `cloud-files.ts`.
- Validate primary/head checkpoint links before writing when possible.
- For pull operations, validate remote manifest heads before applying primary files.
- Apply sync metadata after entity rows so last-synced heads match the pulled manifest.

### `app/src/lib/client/sync/cloud-files.ts`

Potential additions:

- Helper to identify entity type/path from relative cloud path.
- Helper to pair primary files with history files.
- Helper to compare project manifest entity heads to local committed heads and last-synced heads.
- More detailed quarantine path metadata.

No entity primary/history schema format changes expected. `project.json` must contain or be extended to contain current entity head summaries from Subplan 5.

### `app/src/lib/client/db/repositories/cloud-connections.ts`

Use Subplan 5 cloud project folder repository APIs.

Add sync metadata import helper if it belongs here.

### Provider Listing

Discovery should rely on `listFiles` with `recursive: true` for the project root.

Algorithm:

- List all entries under provider project root.
- Find entries whose path ends in `/project.json` or equals `project.json` for selected folder.
- For each project JSON entry, derive folder path/id.
- Download and parse manifest.
- Classify.

Provider nuance:

- Dropbox may represent folder IDs as normalized paths.
- Google Drive has stable folder IDs and appProperties paths.
- Mock provider should be used first for tests.

## UI Plan

### Browser Component

Potential component:

- `app/src/lib/components/projects/CloudProjectBrowser.svelte`

Alternative location:

- `app/src/lib/components/sync/CloudProjectBrowser.svelte`

Recommended placement:

- Put it under `components/projects/` if launched from Projects page.
- Use `components/sync/` if it becomes provider-wide navigation.

Props/state:

- Provider connection list.
- Selected connection.
- Candidate list.
- Loading/error/quarantine state.
- Actions for import, link, open.

### Projects Page Integration

Add a `Cloud Projects` section or modal on `app/src/routes/projects/+page.svelte`.

Actions:

- `Browse cloud projects`
- `Sync locally`
- `Link to this project`
- `Open local project`
- `Pull remote updates`
- `View quarantine details`

### Candidate Detail

For each cloud project show:

- Project name.
- Project ID.
- Folder path.
- Updated time.
- Manifest revision/hash.
- Counts of transcription/collation/tombstone files if available.
- Remote freshness when linked: up to date, remote update available, pending local backup, diverged, unknown.
- Classification badge.
- Action button based on classification.

## Conflict and Quarantine Rules

### Quarantine

Quarantine invalid files rather than failing the entire browser.

Examples:

- Invalid JSON.
- Unsupported schema version.
- Primary points to missing history.
- History hash mismatch.
- Collation references missing project transcription source.

Browser should show:

- Project-level quarantine if `project.json` is invalid.
- Entity-level quarantine if individual entity files are invalid.

Import should default to blocking on quarantines.

### Local Conflict

Classify as conflict when:

- Local project with same ID exists and is linked to a different folder/connection.
- Local project with same ID has local committed heads that differ from cloud and no sync metadata can classify them safely.
- Local project has uncommitted changes that would be overwritten by import/link.
- For a linked project, both local committed heads and remote manifest heads differ from the last synced heads.

Do not overwrite automatically.

## Sync Metadata Preservation

For each imported primary file, insert `cloud_sync_metadata` with:

- `connection_id`
- `scope_type = 'project'`
- `scope_id = projectId`
- `entity_type`
- `entity_id`
- `cloud_file_id`
- `cloud_file_revision`
- `cloud_path`
- `last_synced_revision`
- `last_synced_hash`
- `last_synced_at`

Use provider metadata from the downloaded primary file.

For history files:

- Existing schema tracks primary files, not history files.
- Do not add history metadata unless needed later.

Reasoning:

- Preserving primary cloud metadata prevents immediate duplicate create attempts after restore.
- Recording last synced checkpoint/hash heads lets later polling distinguish pending local backup from remote update available.

## Testing Plan

### Unit Tests

Target files:

- New `project-restore.spec.ts`
- Existing `cloud-files.spec.ts`
- Existing `sync-manager.spec.ts`

Cases:

- Browser finds valid project folders containing `project.json`.
- Invalid project files produce quarantined candidates.
- Import writes project metadata.
- Import writes project transcription primaries and child rows.
- Import writes transcription checkpoints.
- Import writes collation primaries and child rows.
- Import writes collation checkpoints.
- Import writes tombstones.
- Import writes cloud project folder link.
- Import writes sync metadata preserving file IDs/revisions.
- Manifest polling detects remote update available without downloading every primary file.
- Pull downloads only changed primaries/history/tombstones required by the manifest.
- Pull applies remote committed heads after user confirmation.
- Re-running import is idempotent for already imported project.
- Conflicting local project is blocked.
- Diverged local/remote heads are classified and not auto-merged.

### Manual Tests

Manual flow:

1. Use mock provider to create a backed-up project folder.
2. Reset local database.
3. Browse cloud projects.
4. Import the project.
5. Open project, transcription, and collation locally.
6. Verify backup status is already backed up or synced, not pending duplicate upload.
7. Modify a remote manifest/entity in the mock provider and confirm UI shows `Remote update available` without pulling automatically.
8. Pull remote updates and confirm local project changes after confirmation.
9. Corrupt a remote file and confirm quarantine UI.
10. Create a local conflicting project ID and confirm link/import is blocked.

## Verification Commands

Run from `app/`:

```sh
bun run check
bun run db:check
bun run test:unit -- --run src/lib/client/sync/project-restore.spec.ts
bun run test:unit -- --run src/lib/client/sync/cloud-files.spec.ts
bun run test:unit -- --run src/lib/client/sync/sync-manager.spec.ts
```

Run Svelte validation/autofixer for edited `.svelte` and `.svelte.ts` files.

## Acceptance Criteria

- Users can browse cloud project folders with valid `project.json` files.
- Candidates are classified accurately against local state.
- Users can import a cloud project into local OPFS SQLite.
- Imported projects preserve project, transcription, project transcription, collation, and checkpoint IDs.
- Imported projects preserve cloud folder links and primary sync metadata.
- Linked projects can be polled by reading remote `project.json` first.
- Remote update prompts are opt-in; no background pull silently overwrites local data.
- Pull applies remote project transcription, collation, history, tombstone, and sync metadata updates after confirmation.
- Invalid files are quarantined with clear path-specific messages.
- Import does not silently overwrite conflicting local data.
- Mock provider tests cover browser/import behavior.

## Risks and Mitigations

### Risk: Partial Import Leaves Database Inconsistent

Mitigation:

- Use transactions for full import where feasible.
- Validate files before writing.
- Write sync metadata last.

### Risk: Provider Listing Does Not Preserve Folder Identity Uniformly

Mitigation:

- Store provider metadata exactly as returned.
- Use provider abstraction for folder path/id resolution.
- Test Dropbox path-addressing and Google Drive ID-addressing separately.

### Risk: Restore Uploads Duplicates Immediately

Mitigation:

- Preserve primary cloud file IDs/revisions in `cloud_sync_metadata`.
- Set last synced head from cloud primary current revision.

### Risk: Polling Becomes Expensive

Mitigation:

- Poll `project.json` first.
- Download entity primaries/history only after manifest comparison shows a needed pull or health verification requires proof.

### Risk: Pull Overwrites Local Work

Mitigation:

- Block pull when local working state is dirty.
- Compare local, last-synced, and remote manifest heads before applying.
- Treat diverged heads as conflict/unknown instead of auto-merging.

## Open Questions

- Should import allow partial restore when some entity files are quarantined, or block the whole project?
- Should users be able to map a cloud project to a local project with a different ID?
- Should history metadata be tracked separately from primary sync metadata?
- What polling interval is appropriate for linked projects? First implementation can poll visible/open projects more often and background project list less often.

## Recommended First Implementation Slice

1. Build mock-provider cloud project browser and candidate classification.
2. Import project manifest plus project transcription primaries/history.
3. Add collation primaries/history and tombstones.
4. Add manifest polling/comparison for linked projects.
5. Add user-confirmed pull for changed project transcription and collation heads.
6. Add Projects page UI to browse/import/open/pull.
