# Subplan 8: Backup Health, Safe Local Removal, and Space Management

## Selection Rationale

This subplan comes last because safe local removal depends on everything before it: clear status read models, explicit commits, project-contained backup, cloud/local restore, and provider-specific reachability. The app can only tell users data is safe to remove after it can prove the selected backup target is complete and restorable now.

## Goal

Make it clear when local project data can be removed and later restored from a selected backup target.

After this subplan, users should be able to:

- See project-level backup health.
- Understand why a project is or is not safe to remove locally.
- Run `Back up everything first` before removal.
- Remove local project data only after explicit confirmation.
- Restore removed projects from the selected provider/folder later.
- Manage local storage without accidentally deleting unbacked-up scholarly work.

## Non-Goals

- Do not claim safety based only on old local sync metadata.
- Do not remove local data with uncommitted changes without explicit high-friction warning.
- Do not delete remote backups as part of local removal.
- Do not compact or purge OPFS globally unless the user explicitly requests app-wide reset.
- Do not add automatic background cleanup in the first implementation.

## Current Grounding

### Existing Status Inputs

Previous subplans should provide:

- Project transcription dirty-to-checkpoint state.
- Collation dirty-to-checkpoint state.
- Project transcription source/witness version status.
- Cloud backup local metadata state.
- Project folder link state.
- Provider connection state.
- Cloud project browser and restore validation.

### Existing Sync Tables

The schema already has:

- `cloud_project_folders` for project-folder bindings and last full sync timestamp.
- `cloud_sync_metadata` for primary file IDs/revisions and last synced committed heads.
- `sync_tombstones` for deleted project entities.

### Existing Tombstone Support

`app/src/lib/client/sync/conflicts.ts` supports tombstones for project transcriptions and collations:

- `createProjectTranscriptionTombstone`
- `createCollationTombstone`
- `applyProjectTranscriptionTombstone`
- `applyCollationTombstone`

Important distinction:

- Local project removal for space management should not necessarily create remote deletion tombstones.
- A tombstone means the entity was deleted from the project and should be deleted remotely.
- Removing local cached project data while preserving remote backup is a different operation.

This subplan must keep those concepts separate.

## Product Semantics

### Backup Health

Backup health is the current ability to restore a project from a selected provider/folder.

Status labels:

- `local-only`
- `uncommitted changes`
- `committed pending backup`
- `backed up`
- `conflict`
- `unknown provider state`
- `incomplete backup`
- `restorable now`

### Safe to Remove

Safe to remove means:

- A selected provider/folder is reachable now.
- `project.json` is present and valid remotely.
- Every local committed project transcription primary has a matching remote primary.
- Every remote primary points to an existing valid history checkpoint.
- Every local committed collation primary has a matching remote primary.
- Every remote collation primary points to an existing valid history checkpoint.
- Required tombstones are backed up.
- No local entity has uncommitted working changes.
- No known conflict or quarantine exists.
- Cloud folder link and metadata are consistent enough for restore.

Not safe:

- Local metadata merely says something was synced sometime in the past, but provider cannot be reached.
- Project has dirty working edits.
- Project has committed pending-backup items.
- Remote files are missing, invalid, or quarantined.
- Provider permission is revoked.

### Remove Local

Remove local means deleting the local OPFS SQLite rows for a project and its project-contained entities while preserving the remote backup.

Rules:

- Do not create remote tombstones.
- Do not delete remote files.
- Do not remove library/global transcriptions unless they are only temporary artifacts explicitly selected for removal.
- Remove project-owned transcriptions, project links, collations, artifacts, checkpoints, cloud sync metadata, cloud project folder links, and local tombstones for that project.
- Leave reusable library transcriptions intact.

## Health Derivation Plan

### Inputs

Derive project health from:

- Project transcription statuses.
- Collation version statuses.
- Witness source metadata readiness.
- Local committed heads.
- `cloud_sync_metadata` matching committed heads.
- `cloud_project_folders` selected target.
- Provider reachability.
- Remote project manifest validity.
- Remote project manifest entity heads matching local committed heads.
- Remote primary/history validation.
- Tombstone backup status.
- Quarantine/conflict state.

### Local-Only Health

Without provider network calls, derive:

- Dirty/uncommitted local changes.
- Committed pending backup based on stale/missing `cloud_sync_metadata`.
- Last known backup time.
- Known conflicts from last sync operation if stored.

### Remote-Verified Health

With provider network calls, derive:

- Project manifest present and valid.
- Project manifest entity heads match local committed heads for current project transcriptions, collations, and tombstones.
- All expected remote primary files present.
- Every primary current revision has matching history file.
- Remote hashes validate.
- Tombstones present.
- Provider permission/reachability.

Remote-verified health is required for `safe to remove`.

## Repository and Service Plan

### Health Service

Create a dedicated health service:

- `app/src/lib/client/sync/backup-health.ts`

Recommended types:

```ts
export type ProjectBackupHealthStatus =
	| 'local-only'
	| 'uncommitted-changes'
	| 'committed-pending-backup'
	| 'backed-up-local-metadata'
	| 'restorable-now'
	| 'conflict'
	| 'unknown-provider-state'
	| 'incomplete-backup';

export interface ProjectBackupHealth {
	projectId: string;
	connectionId: string | null;
	status: ProjectBackupHealthStatus;
	safeToRemove: boolean;
	checks: BackupHealthCheck[];
	blockingChecks: BackupHealthCheck[];
	lastFullySyncedAt: string | null;
}

export interface BackupHealthCheck {
	id: string;
	label: string;
	status: 'pass' | 'fail' | 'warning' | 'unknown';
	message: string;
	blocking: boolean;
}
```

Recommended functions:

- `deriveLocalProjectBackupHealth(db, projectId, connectionId?)`
- `verifyRemoteProjectBackupHealth(db, provider, context)`
- `deriveSafeRemovalChecklist(db, provider, context)`

### Local Removal Repository

Add project local removal operations in a repository or new module.

Potential module:

- `app/src/lib/client/db/repositories/project-removal.ts`

Recommended functions:

```ts
export interface RemoveLocalProjectInput {
	projectId: string;
	connectionId?: string;
	confirmedUnsafe?: boolean;
	removedAt?: string;
}

export interface RemoveLocalProjectResult {
	projectId: string;
	removedProjectTranscriptions: number;
	removedProjectOwnedTranscriptions: number;
	removedCollations: number;
	removedCheckpoints: number;
	removedSyncMetadata: number;
}
```

Deletion order:

1. Load project-owned transcription row IDs and collation IDs.
2. Delete collation child rows/artifacts/checkpoints.
3. Delete collations.
4. Delete project transcription checkpoints for project-owned transcription rows.
5. Delete IIIF rows and verse index rows for project-owned transcriptions.
6. Delete project transcription links.
7. Delete project-owned transcription rows.
8. Delete project-level tombstones from local cache only if they are backed up or user confirms.
9. Delete cloud sync metadata for project scope.
10. Delete cloud project folder link.
11. Delete project row.

Important rule:

- This operation is local removal, not project deletion. Do not create tombstones for all entities.

### Sync Service Integration

Add `Back up everything first` flow:

1. Derive health.
2. If not safe because pending committed backup exists, run Subplan 5 project backup.
3. Re-verify remote health.
4. If safe, enable removal.
5. If still unsafe, show blocking checks.

## UI Plan

### Project Health Panel

Add health summary to Projects page, likely near the backup panel.

Show:

- Overall status badge.
- Selected provider/folder.
- Last verified time.
- Checklist of safety checks.
- `Verify backup now` button.
- `Back up everything first` button when pending backup is the main blocker.
- `Remove local copy` button only when safe or after high-friction unsafe confirmation.

### Remove Local Flow

Use a confirmation dialog with a checklist.

Safe flow:

- Show `This project is restorable from {provider/folder}.`
- Require typing project name or checking a confirmation box.
- Button: `Remove local copy`.

Unsafe flow:

- Default should block removal.
- Offer `Back up everything first` if possible.
- If product allows unsafe removal, require a high-friction override with clear data-loss warning.

Recommended first implementation:

- Do not allow unsafe removal except in development/debug mode.

### Space Management View

Optionally add a project storage overview later.

First implementation can stay on Projects page.

Future view could show:

- Local project count.
- Approximate row/file counts.
- Last verified backup.
- Safe-to-remove projects.

## Remote Verification Algorithm

1. Resolve selected provider connection and project folder context.
2. Download and parse `project.json`.
3. Compare project ID to local project ID.
4. Confirm manifest entity heads match local committed heads.
5. List remote files recursively.
6. For each local project transcription with committed head:
   - Find `transcriptions/{projectTranscriptionId}.json`.
   - Parse and validate primary.
   - Confirm primary current revision equals local committed head.
   - Find matching history file.
   - Parse and validate history.
7. For each local collation with committed head:
   - Find `collations/{collationId}.json`.
   - Parse and validate primary.
   - Confirm primary current revision equals local committed head.
   - Find matching history file.
   - Parse and validate history.
8. For each local tombstone:
   - Confirm `tombstones/{tombstoneId}.json` exists and parses.
9. Check for local dirty state.
10. Return checklist and safe/unsafe result.

## Local Removal Algorithm

1. User selects `Remove local copy`.
2. App derives local health.
3. App verifies remote health.
4. If not safe, block and show checklist.
5. If safe, ask for confirmation.
6. Run local removal transaction.
7. Update UI project list.
8. Offer `Restore from backup` action that opens cloud project browser.

## Testing Plan

### Unit Tests

Target files:

- New `backup-health.spec.ts`
- New `project-removal.spec.ts`
- Existing `sync-manager.spec.ts`
- Existing `project-restore.spec.ts` from Subplan 6

Cases:

- Health reports dirty project transcription as unsafe.
- Health reports dirty collation as unsafe.
- Health reports committed pending backup as unsafe.
- Health reports remote manifest head mismatch as unsafe.
- Health reports missing remote primary as unsafe.
- Health reports missing history as unsafe.
- Health reports invalid hash/quarantine as unsafe.
- Health reports valid remote backup as safe.
- `Back up everything first` can transition pending backup to safe.
- Local removal deletes project-owned transcriptions/collations/checkpoints/sync metadata.
- Local removal leaves library/global transcriptions intact.
- Local removal does not create tombstones.
- Removed project can be restored from provider backup.

### Manual Tests

Manual flow:

1. Create project with transcription and collation.
2. Commit and back up everything.
3. Verify backup health.
4. Remove local copy.
5. Confirm project disappears locally.
6. Browse backup provider and restore project.
7. Confirm restored project opens correctly.
8. Try removal with dirty edits and confirm blocked.
9. Try removal with missing remote file and confirm blocked.

## Verification Commands

Run from `app/`:

```sh
bun run check
bun run db:check
bun run test:unit -- --run src/lib/client/sync/backup-health.spec.ts
bun run test:unit -- --run src/lib/client/db/repositories/project-removal.spec.ts
bun run test:unit -- --run src/lib/client/sync/sync-manager.spec.ts
```

Run Svelte validation/autofixer for edited `.svelte` and `.svelte.ts` files.

## Acceptance Criteria

- Project health is derived from local dirty state, committed heads, sync metadata, tombstones, provider state, remote manifest heads, and remote file validation.
- UI clearly shows whether a project is safe to remove.
- Unsafe local removal is blocked by default.
- `Back up everything first` is available when backup can fix unsafe state.
- Local removal deletes only local project-contained data.
- Local removal does not delete remote backup files.
- Local removal does not create deletion tombstones.
- Removed projects can be restored through Subplan 6 browser.
- Library/global transcriptions remain local unless explicitly removed through a separate flow.

## Risks and Mitigations

### Risk: Mistaking Remote Deletion for Local Removal

Mitigation:

- Use distinct naming: `Remove local copy`, not `Delete project`.
- Do not call tombstone creation functions.
- Do not call provider delete operations.

### Risk: False Sense of Safety From Stale Metadata

Mitigation:

- Require remote verification for safe removal.
- Label local-only metadata as last known backup, not proof.

### Risk: Removal Transaction Misses Child Rows

Mitigation:

- Write repository tests that count all related rows before/after.
- Prefer explicit delete order over relying on cascades unless schema guarantees cascades.

### Risk: Large Projects Make Verification Slow

Mitigation:

- Show progress by check category.
- Cache last verification result with timestamp only for display, not for final removal.
- Allow cancellation in UI later if needed.

## Open Questions

- Should unsafe removal ever be allowed outside development mode?
- Should verification require all historical checkpoints or only current primary-referenced checkpoints for safe removal?
- Should local removal keep `cloud_project_folders` as a lightweight bookmark, or delete it with the project row? First implementation should delete with the project row and rely on browser rediscovery.

## Recommended First Implementation Slice

1. Implement remote-verified backup health for current heads only.
2. Add Projects page safe-to-remove checklist.
3. Add local removal repository transaction.
4. Verify remove-and-restore with mock provider.

Then add storage overview and more detailed space management.
