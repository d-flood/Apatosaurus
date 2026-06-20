# Subplan 5: Intentional Cloud Backup and Project Publish UI

## Selection Rationale

This subplan comes after explicit local commits because cloud backup must publish committed project-contained artifacts, not arbitrary autosaved working state. The lower-level serialization and sync primitives already exist, but the user-facing project backup operation is incomplete.

## Goal

Make cloud backup feel like `commit and push`, not invisible autosync.

After this subplan, users should be able to:

- Connect a supported provider.
- See which provider/folder is the backup target for a project.
- See uncommitted local edits that block backup.
- See committed local versions that have not been backed up.
- Back up an entire project intentionally.
- Back up an individual project transcription or collation intentionally.
- See whether a linked remote backup has a newer committed project version available.
- Fork a project into a new project ID and back the fork up to another provider/folder.
- See conflicts and provider errors clearly.

## Non-Goals

- Do not upload autosaved dirty working state.
- Do not create shared cloud transcription references.
- Do not implement cloud project browsing/restore. That belongs to Subplan 6.
- Do not implement local filesystem provider. That belongs to Subplan 7.
- Do not implement safe local removal. That belongs to Subplan 8.
- Do not make background polling silently publish uncommitted local work.
- Do not treat provider file revisions as scholarly version identity. Provider revisions are only transport-level change detectors.
- Do not fork by reusing the same project ID. Forks create a new project ID so they can coexist locally and sync independently.

## Current Grounding

### Existing Cloud Layout

`app/src/lib/client/sync/cloud-files.ts` defines the project-contained cloud layout:

- `project.json`
- `transcriptions/{projectTranscriptionId}.json`
- `collations/{collationId}.json`
- `history/transcriptions/{projectTranscriptionId}/{checkpointId}.json`
- `history/collations/{collationId}/{checkpointId}.json`
- `tombstones/{tombstoneId}.json`

`projectCloudRootPath(projectId)` returns `Apatosaurus/Projects/{projectId}`.

`project.json` should be treated as the project manifest, not only as a metadata file. It is the cheap remote index for determining whether a linked project is up to date.

Required manifest head data:

- Project ID, title, description, and manifest schema version.
- A project manifest revision or content hash that changes whenever the manifest's entity-head summary changes.
- For each current project transcription: `projectTranscriptionId`, project-owned transcription row ID if preserved, current committed checkpoint ID, current content hash, title/siglum summary, and primary path.
- For each current collation: `collationId`, current committed checkpoint ID, current content hash, title/verse summary, and primary path.
- Tombstone IDs and tombstone content hashes or timestamps sufficient to detect pending remote deletes.
- Optional backup metadata such as app version, backup time, and provider-independent author/device label.

The manifest should summarize current heads for freshness and restore planning. It does not need to duplicate every historical checkpoint in the first implementation; full version history remains in `history/...` files.

Version rule:

- The canonical version for a transcription or collation is the pair `{currentRevisionId, currentContentHash}` from its committed checkpoint.
- A monotonic manifest version is useful for quick polling, but it must not replace entity checkpoint/hash comparison before applying or declaring an entity current.

### Existing Serialization

Serialization functions already exist:

- `serializeProjectCloudFile`
- `serializeProjectTranscriptionCloudFile`
- `serializeProjectTranscriptionHistoryCloudFile`
- `serializeCollationCloudFile`
- `serializeCollationHistoryCloudFile`
- `serializeTombstoneCloudFile`

Important current behavior:

- Project transcription primary serialization rejects uncommitted changes.
- Collation primary serialization rejects uncommitted changes.
- Collation serialization also rejects witnesses missing committed source revision metadata.

### Existing Sync Manager Primitives

`app/src/lib/client/sync/sync-manager.ts` already provides:

- `commitProjectTranscriptionForSync`
- `commitCollationForSync`
- `publishEntity`
- `pollOpenEntity`
- `syncProjectTombstones`
- `deriveLocalSyncUiState`
- `OpenObjectSyncPoller`

`publishEntity` already:

- Loads local committed head.
- Refuses to publish if no committed head or dirty working state exists.
- Ensures history file exists.
- Writes primary file.
- Updates `cloud_sync_metadata`.
- Surfaces conflicts/quarantines/provider errors.

What is missing:

- Project-level backup orchestration.
- `project.json` publishing integrated with a backup operation.
- UI for choosing/viewing project backup target.
- UI for backing up all committed project-contained entities in one action.
- UI that distinguishes explicit backup from polling.

### Existing Connection UI

`app/src/lib/components/CloudConnectButton.svelte` currently connects Dropbox only.

`app/src/lib/client/sync/cloud-auth.ts` stores Dropbox connections in `cloud_connections`.

`app/src/lib/client/db/repositories/cloud-connections.ts` supports listing/upserting/disconnecting connections and stores credentials.

`sync-service.svelte.ts` currently exposes a small app-level UI state and is not a full project backup orchestrator.

### Existing Cloud Project Folder Schema

The schema includes `cloud_project_folders` with:

- `project_id`
- `connection_id`
- `cloud_folder_id`
- `cloud_folder_path`
- `sync_cursor`
- `last_fully_synced_at`

Repository functions for this table are not yet implemented beyond deletion through cloud connection cleanup.

Implementation note: the current migration defines `cloud_project_folders.project_id` as the primary key, so the first repository/API slice supports one backup folder binding per project. Supporting multiple simultaneous backup folders per project requires a later schema migration before the product requirement for multiple backups can be completed.

## Product Semantics

### Backup

Backup means uploading committed local project state to a chosen provider/folder.

Backup includes:

- Project manifest.
- Latest committed project transcription primaries.
- Required transcription history checkpoint files.
- Latest committed collation primaries.
- Required collation history checkpoint files.
- Tombstones.

Backup does not include:

- Library/global transcriptions outside the project folder.
- Dirty working rows that differ from committed checkpoints.
- Uncommitted draft checkpoints.

### Publish Entity

Publishing an entity means backing up one project transcription or one collation.

Rules:

- Entity must have a committed head.
- Entity working state must be clean-to-checkpoint.
- Entity history file should be uploaded before primary file.
- Primary file should point to a history checkpoint that exists remotely.

### Project Backup

Backing up a project means publishing:

- `project.json`
- Every eligible project transcription.
- Every eligible collation in the project.
- Tombstones for deleted project entities.

If some entities are blocked by uncommitted state, the project backup operation should report partial readiness and ask for explicit action rather than uploading stale or dirty state.

Manifest write ordering:

- Upload history files before entity primary files.
- Upload entity primary files before `project.json` when the manifest advertises those heads.
- If `project.json` upload fails after entity uploads succeed, report the project backup as incomplete because remote polling cannot safely advertise the new remote heads yet.

### Remote Freshness

Remote freshness is checked by comparing local committed heads to the entity heads in the remote `project.json` manifest.

Rules:

- Local entity up to date with remote: local `{currentRevisionId, currentContentHash}` equals the manifest entity head.
- Local committed pending backup: local committed head differs from the last uploaded/manifest head, and the remote head still equals the last synced head.
- Remote update available: local committed head equals the last synced head, but the remote manifest head differs.
- Diverged or conflict: both local committed head and remote manifest head differ from the last synced head. Full conflict resolution is out of scope; show a conservative warning.
- Dirty local working state always takes priority in UI and must be committed before backup or pull can be considered safe.

This comparison should use checkpoint IDs and content hashes, not timestamps.

### Fork Project

Forking means creating an independent project for experimentation or for backup to another provider/folder.

Rules:

- Generate a new project ID.
- Copy full project metadata, project transcriptions, collations, current committed heads, history/checkpoints, artifacts, and relevant provenance.
- Rewrite project-local IDs where needed so the fork is internally consistent. Preserve provenance fields that point back to the source project for traceability.
- Do not link the fork to the source project's cloud folder.
- After creating the fork locally, let the user choose a backup target and run the normal project backup flow.

## UX Requirements

### Project Backup Panel

Add a panel on the Projects page for the selected project.

The panel should show:

- Provider connection status.
- Backup folder path/label.
- Remote manifest status: up to date, remote update available, pending backup, diverged, or unknown.
- Last full backup time from `cloud_project_folders.last_fully_synced_at`.
- Counts of uncommitted local edits.
- Counts of committed pending backup entities.
- Counts of backed-up entities.
- Conflicts/quarantines.
- Last checked remote manifest time.
- Tombstones pending backup.
- Main action: `Back up project`.
- Secondary action: `Back up everything eligible` if some items are blocked.
- Secondary action: `Pull remote updates` when the remote manifest has newer heads and local state is safe.
- Secondary action: `Fork project` for independent experimentation or copying to another backup target.

Suggested states:

- `No backup target selected`
- `Ready to back up`
- `Commit changes before backup`
- `Backup pending`
- `Backed up`
- `Remote update available`
- `Conflict requires resolution`
- `Provider unavailable`

### Per-Entity Backup Actions

Add on-demand upload actions where status panels already show entity state:

- Project transcription rows.
- Collation workspace/page.

Actions:

- `Back up committed version`
- `Commit before backup` when dirty.
- `Resolve conflict` when conflict/quarantine exists.

### Explicit Versus Background

If background polling remains enabled, it should:

- Read the remote `project.json` manifest.
- Compare remote entity heads to local committed heads and last-synced heads.
- Detect remote updates.
- Detect conflicts.
- Update status.
- Not upload dirty local working state.
- Not silently convert autosave into backup.
- Not pull remote changes without explicit user confirmation.

For the first implementation, prefer user-initiated upload only.

## Repository and Service Plan

### `app/src/lib/client/db/repositories/cloud-connections.ts`

Add cloud project folder repository APIs.

Recommended types:

```ts
export interface CloudProjectFolderRecord {
	projectId: string;
	connectionId: string;
	cloudFolderId: string;
	cloudFolderPath: string;
	syncCursor: string;
	lastFullySyncedAt: string | null;
}
```

Recommended functions:

- `listCloudProjectFolders(db, projectId)`
- `getCloudProjectFolder(db, projectId, connectionId)`
- `upsertCloudProjectFolder(db, input)`
- `updateCloudProjectFolderSyncState(db, input)`
- `unlinkCloudProjectFolder(db, projectId, connectionId)`

Reasoning:

- Project backup needs a durable mapping from local project to provider folder.
- Restore will reuse this mapping in Subplan 6.

### `app/src/lib/client/sync/sync-manager.ts`

Add project-level orchestration.

Recommended types:

```ts
export interface ProjectBackupSummary {
	projectId: string;
	connectionId: string;
	cloudFolderId: string;
	projectManifestState: BackupItemState;
	transcriptions: BackupItemState[];
	collations: BackupItemState[];
	tombstones: BackupItemState[];
	remoteManifestState: 'not-checked' | 'up-to-date' | 'remote-update-available' | 'diverged' | 'unavailable';
	blockingItems: BackupItemState[];
	pendingItems: BackupItemState[];
	lastFullySyncedAt: string | null;
}

export interface ProjectBackupResult extends SyncOperationResult {
	projectId: string;
	manifestUploaded: boolean;
	entityResults: SyncOperationResult[];
	skippedItems: BackupItemState[];
}
```

Recommended functions:

- `deriveProjectBackupSummary(db, context)`
- `publishProjectManifest(db, provider, context, options?)`
- `downloadAndCompareProjectManifest(db, provider, context)`
- `backupProject(db, provider, context, options?)`
- `backupEligibleProjectEntities(db, provider, context, options?)`
- `backupProjectEntity(db, provider, context, reference, options?)`
- `forkProjectForBackup(db, input)`

Project backup algorithm:

1. Derive summary.
2. If blocking dirty items exist and strict mode is enabled, return blocked result.
3. Ensure/confirm project cloud folder exists.
4. Publish eligible project transcriptions with `publishEntity`.
5. Publish eligible collations with `publishEntity`.
6. Sync tombstones with `syncProjectTombstones`.
7. Upload `project.json` manifest last so it advertises only remote heads whose primaries/history were uploaded successfully.
8. Update `cloud_project_folders.last_fully_synced_at` if no blocking items, conflicts, or provider errors remain.

Important rule:

- Upload history before primary for each entity. `publishEntity` already does this.
- Upload manifest after successful entity/tombstone publishing because it is the remote freshness index.

### `app/src/lib/client/sync/cloud-files.ts`

Manifest format changes are expected if `project.json` does not already contain the entity-head summary described above. Entity primary/history formats should not need to change.

Potential additions:

- Helpers to derive manifest path and project folder path consistently.
- Helpers to build and parse project manifest entity-head summaries.
- Helpers to compare manifest heads against local committed heads and last-synced heads.
- More precise serialization error types for UI messages.

### `app/src/lib/client/sync/sync-service.svelte.ts`

Expand from global status holder to project-aware orchestration service or create a new service.

Recommended approach:

- Create a project backup service if `syncService` is too global.
- Keep `syncService` for nav-level status summary.

Potential new service:

- `app/src/lib/client/sync/project-backup-service.svelte.ts`

Responsibilities:

- Load connections and project folder mapping.
- Instantiate provider from connection credentials.
- Drive `deriveProjectBackupSummary` and `backupProject`.
- Reflect result into `syncService.uiState` for nav badge.

### Provider Factory

Add a provider factory abstraction if one does not exist.

Recommended function:

```ts
export function createProviderForConnection(connection: CloudConnectionRecord): CloudStorageProvider;
```

Rules:

- Dropbox uses `DropboxStorageProvider` with credentials and credential update callback.
- Google Drive uses `GoogleDriveStorageProvider` with credentials and credential update callback.
- Mock provider is used in tests/dev only.
- Local filesystem provider is added in Subplan 7.

### UI Components

Potential components:

- `app/src/lib/components/projects/ProjectBackupPanel.svelte`
- `app/src/lib/components/projects/BackupItemList.svelte`
- `app/src/lib/components/sync/ProviderFolderPicker.svelte`

Keep first implementation simple:

- One panel on `projects/+page.svelte`.
- Reuse existing provider connection data.
- Add folder creation/selection only as needed.

### Projects List Summary

The project list should show a concise backup status per project:

- `Local only` when no remote location is linked.
- `{Provider}: {folder}` when one remote location is linked.
- `Multiple backups` when more than one remote location is linked.
- `Pending backup` when local committed heads are not in the linked manifest.
- `Remote update available` when polling sees remote manifest heads newer than local.
- `Provider unavailable` when the linked provider cannot be checked.

## Folder Binding Flow

### First Backup

1. User selects a project.
2. Backup panel detects no `cloud_project_folders` row.
3. User clicks `Choose backup target` or `Create project backup folder`.
4. Service creates/fetches folder under provider's project root.
5. Service writes `cloud_project_folders` row.
6. Panel shows folder path.

Default folder path:

- `Apatosaurus/Projects/{projectId}`

Provider details:

- Dropbox may be path-addressed.
- Google Drive may be ID-addressed but should preserve relative paths through provider implementation.
- Mock provider should be first target for tests.

## Backup Health Derivation

For each entity:

- If no committed head: `never-committed` and blocked.
- If dirty-to-checkpoint: `uncommitted-local-changes` and blocked.
- If current committed head matches `cloud_sync_metadata`: `backed-up`.
- If committed head differs or metadata is absent: `committed-pending-backup`.
- If last operation returned quarantine/conflict: `conflict`.
- If the last checked remote manifest has a different entity head and local still equals last synced head: `remote-update-available`.
- If local committed head and remote manifest head both differ from the last synced head: `diverged`.

For project manifest:

- Compare the local manifest content hash with the remote manifest file or stored manifest metadata.
- If manifest metadata tracking is incomplete, upload manifest on each explicit project backup.
- Polling should download only `project.json` first; download entity primaries/history only after the user opts into pull or when health verification needs proof.

## Testing Plan

### Unit Tests

Target files:

- `app/src/lib/client/sync/sync-manager.spec.ts`
- `app/src/lib/client/sync/cloud-files.spec.ts`
- `app/src/lib/client/db/repositories/cloud-connections.spec.ts`

Cases:

- Project backup uploads `project.json`.
- Project backup uploads transcription history before transcription primary.
- Project backup uploads collation history before collation primary.
- Project backup uploads `project.json` after eligible primaries/history so manifest heads are not advertised early.
- `project.json` contains project transcription and collation checkpoint/hash heads.
- Remote manifest comparison reports up to date, pending backup, remote update available, and diverged states correctly.
- Dirty project transcription blocks project backup.
- Dirty collation blocks project backup.
- Eligible-only mode skips dirty entities and uploads clean committed entities.
- Tombstones upload and guarded remote primary deletion still work.
- `last_fully_synced_at` updates only when no blocking/errors remain.
- Mock provider conflict surfaces as `conflict requires resolution`.
- Forking a project creates a new project ID with copied project transcriptions, collations, checkpoints, and no inherited folder link.

### UI Manual Tests

Manual flow:

1. Connect mock or Dropbox provider.
2. Select a project with committed transcription and collation.
3. Open backup panel and verify readiness.
4. Click `Back up project`.
5. Confirm `project.json`, primary files, history files, and tombstones are written.
6. Edit without commit and confirm backup is blocked.
7. Commit and confirm backup becomes eligible.
8. Modify remote manifest in mock provider and confirm `Remote update available` appears without pulling automatically.
9. Simulate remote conflict and confirm conflict UI.
10. Fork project to a new backup target and confirm the fork has a new project ID.

## Verification Commands

Run from `app/`:

```sh
bun run check
bun run db:check
bun run test:unit -- --run src/lib/client/sync/sync-manager.spec.ts
bun run test:unit -- --run src/lib/client/sync/cloud-files.spec.ts
bun run test:unit -- --run src/lib/client/db/repositories/cloud-connections.spec.ts
```

Run Svelte validation/autofixer for edited `.svelte` and `.svelte.ts` files.

## Acceptance Criteria

- Projects page has a project backup panel.
- A project can be bound to a provider/folder.
- Explicit project backup uploads manifest, eligible entity primaries/history, and tombstones.
- Manifest summarizes current committed heads for project transcriptions, collations, and tombstones.
- Entity up-to-date checks compare checkpoint ID/content hash pairs from local state and remote manifest.
- Dirty or never-committed entities block or skip with clear reasons.
- Per-entity backup actions reuse the same rules.
- Project list shows each project's remote backup target or `Local only` status.
- Remote polling detects remote manifest updates and prompts for pull without applying changes automatically.
- Fork flow creates a new project ID and can back the fork up to a selected provider/folder.
- Background polling does not silently upload uncommitted local work.
- Backup results expose uploaded paths, skipped items, conflicts, and provider errors.
- Mock provider tests cover project-level backup.

## Risks and Mitigations

### Risk: Backup Claims Success While Some Items Were Skipped

Mitigation:

- Use explicit result categories: uploaded, skipped, blocked, conflict.
- Update `last_fully_synced_at` only for complete successful backups.

### Risk: Provider Folder Semantics Differ

Mitigation:

- Keep provider operations behind `CloudStorageProvider`.
- Store both folder ID and display path.
- Test with mock provider first.

### Risk: Manifest Metadata Tracking Is Underdefined

Mitigation:

- Upload `project.json` every project backup initially.
- Add manifest-specific sync metadata later if needed.

### Risk: Manifest Advertises Entity Heads Before Files Exist

Mitigation:

- Upload history and primary files before `project.json`.
- Treat manifest upload failure as incomplete project backup.
- Remote health verification must ensure primary/history files exist before safe local removal.

## Open Questions

- Should project backup default to strict blocking or upload eligible committed items while reporting blocked dirty items?
- Should the user be able to choose an arbitrary provider folder in this subplan, or only create/use the default project folder path?
- Should `SyncStatusIndicator` become project-aware or remain a global summary?
- Should `project.json` keep only current heads, or also a compact list of historical checkpoint IDs for each entity? First implementation should keep current heads and rely on `history/` files for full history.

## Recommended First Implementation Slice

1. Add cloud project folder repository functions.
2. Add provider factory and mock-provider-backed project context setup.
3. Extend/build `project.json` manifest serialization with entity checkpoint/hash heads.
4. Add `publishProjectManifest`, manifest comparison, and `backupProject` orchestration.
5. Add `ProjectBackupPanel` and project-list backup summaries to the Projects page.
6. Add first-pass fork-project-to-new-ID command and UI entry.
7. Test with mock provider.
