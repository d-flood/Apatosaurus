# Subplan 1: Domain Vocabulary and Status APIs

## Selection Rationale

Start with this subplan because it establishes the language and read models that every later project storage, versioning, refresh, and backup workflow depends on. The current database already contains most of the required identity and version information, but the application APIs do not consistently expose it. Implementing UI actions before fixing that vocabulary would make later work harder and would likely preserve the current ambiguity between reusable library transcriptions, project transcriptions, and collation witness sources.

This plan expands Subplan 1 from `.opencode/plans/1781185624361-sunny-pixel.md` into an implementation-ready planning document. It intentionally avoids schema changes for the first pass.

## Goal

Make the existing model explicit in code and UI-facing service APIs before adding more sync or version-management UI.

The desired outcome is a small set of reliable, typed read models that answer these questions without callers needing to know the raw table layout:

- Which transcription row is reusable library source material?
- Which transcription row is the editable full project transcription?
- Which `project_transcriptions.id` is the stable project-local identity for sync paths, collation witnesses, and future refresh actions?
- Is a project transcription dirty relative to its current committed checkpoint?
- What source version was a project transcription created from?
- Does the source now have a newer committed version available?
- Is a collation dirty relative to its committed checkpoint?
- Which committed transcription version is each collation witness pinned to?
- Does a witness source now have a newer committed version available?
- What local metadata exists about whether the committed version has been backed up?
- Which remote backup target, if any, is linked to the project?
- What remote committed heads were last seen in that target's project manifest?

## Non-Goals

- Do not implement local commit UI. That belongs to Subplan 2.
- Do not implement project transcription refresh. That belongs to Subplan 3.
- Do not implement collation witness refresh. That belongs to Subplan 4.
- Do not implement project backup orchestration or remote browser flows. Those belong to Subplans 5 and 6.
- Do not create a new cloud file format.
- Do not add shared cloud transcription references.
- Do not change the SQLite schema unless implementation proves an unavoidable gap. The current expectation is that no schema migration is needed.
- Do not change the existing minimal list APIs in place if existing UI depends on their current shapes. Prefer adding explicit read models.

## Current Grounding

### Existing Persistence Model

Local persistence is SQLite in OPFS, accessed through `app/src/lib/client/db/*` and the local DB worker RPC boundary.

The generated schema already includes the important identity and version fields:

- `transcriptions.scope_type` distinguishes reusable global records from project-owned transcription rows. The current internal value for project-owned rows is `project_snapshot`; treat this as a legacy storage label, not a product concept or a lightweight snapshot/reference model.
- `transcriptions.project_id` links project-owned transcription rows to a project.
- `transcriptions.origin_type`, `origin_project_id`, `origin_transcription_id`, `origin_revision_id`, and `origin_content_hash` record provenance for copied transcriptions.
- `transcriptions.current_revision_id` and `current_content_hash` record the current committed checkpoint head for a transcription row.
- `project_transcriptions.id` is the durable project-local link ID.
- `project_transcriptions.transcription_id` points to the editable full project transcription row.
- `project_transcriptions.canonical_transcription_id` points back to the reusable canonical source when known.
- `collations.current_revision_id` and `current_content_hash` record the current committed checkpoint head for a collation.
- `collation_witnesses.project_transcription_id`, `transcription_id`, `source_revision_id`, and `source_content_hash` pin witness source content.
- `transcription_checkpoints` and `collation_checkpoints` store committed checkpoint payloads.
- `cloud_sync_metadata` records local knowledge of uploaded cloud file IDs, revisions, and last synced committed heads.

### Existing Repository Behavior

`app/src/lib/client/db/repositories/projects.ts` already clones source transcriptions into project-owned transcription rows through `syncProjectTranscriptionIds` and `addProjectTranscriptionSnapshot`. It creates a new `transcriptions` row with the current internal `scope_type = 'project_snapshot'`, links it through `project_transcriptions`, and copies IIIF and verse index rows.

`listProjectTranscriptionOptions` currently returns a mixed list shaped for selection UI. For project-linked rows, the returned `id` is the internal `transcriptions.id`, not the stable `project_transcriptions.id`. That is acceptable for current selection UI, but it is insufficient for sync and version UI.

`app/src/lib/client/db/repositories/revisions.ts` already contains the important checkpoint operations:

- `createCommittedTranscriptionCheckpoint`
- `createCommittedCollationCheckpoint`
- `isTranscriptionDirty`
- `isCollationDirty`
- `loadProjectTranscriptionSnapshot`
- `loadSerializedCollation`
- `buildTranscriptionHashPayload`
- `buildCollationHashPayload`

The existing dirty helpers return only booleans. Later UI needs richer state: current checkpoint IDs, hashes, computed working hashes, source heads, and reason codes.

`app/src/lib/client/db/repositories/collations.ts` already stores witness source metadata when saving projections. `loadProjection` returns `sourceVersion` but not the full pinned source metadata needed for refresh/status UI.

`app/src/lib/client/sync/cloud-files.ts` already refuses to serialize project transcription and collation primaries when the working hash does not match the current committed hash. This is the correct invariant, but UI needs read models that can explain that state before a backup action fails.

`app/src/lib/client/sync/sync-manager.ts` already has lower-level sync state concepts such as `SyncUiState`, `deriveLocalSyncUiState`, `publishEntity`, and `pollOpenEntity`. Subplan 1 should expose enough local status for future panels without making cloud backup automatic.

## Product Vocabulary

Use the following terms consistently in code, UI text, and future plans.

### Project

The top-level data object users work with, back up, restore, fork, and remove locally.

Rules:

- A project owns its project transcriptions, collations, version history, tombstones, and backup-location links.
- A project backup must be self-contained enough to restore the project's transcriptions and collations without a separate library export.
- Project list UI should be the primary place to show remote backup location and sync state.

UI language:

- Prefer "Project" for the aggregate.
- Avoid presenting transcriptions or collations as top-level cloud-synced objects outside a project.

### Library Transcription

A reusable local transcription record that can be copied into one or more projects.

Database representation:

- `transcriptions.scope_type = 'global'`
- `transcriptions.project_id is null`

Rules:

- It is source material, not the live object that project collations should depend on.
- Editing a library transcription must not silently update project transcriptions.
- If a committed source version exists, project transcriptions can explicitly refresh from it in Subplan 3.

UI language:

- Prefer "Library transcription".
- Avoid "global transcription" in user-facing UI unless a developer/debug label is needed.

### Project Transcription

The editable full transcription data that belongs to one project.

Database representation:

- A row in `transcriptions`
- `scope_type = 'project_snapshot'` in the current schema. This is an internal legacy label.
- `project_id = <project id>`

Rules:

- It is the complete transcription content users edit inside a project.
- It can diverge from its library source.
- It has its own committed checkpoints.
- It is the transcription content that collation witnesses should use.
- It is backed up inside the project folder, not as a reference to a library transcription.

UI language:

- Prefer "Project transcription".
- Use "Copied from library" or "Copied from another project" for provenance, not as the primary object name.

### Project Transcription Link

The durable project-local relationship between a project and a project transcription.

Database representation:

- A row in `project_transcriptions`
- `project_transcriptions.id` is the stable link ID.
- `project_transcriptions.transcription_id` points to the project-owned transcription row.
- `project_transcriptions.canonical_transcription_id` points to the reusable source when known.

Rules:

- This ID is the project-local identity that cloud paths use: `transcriptions/{projectTranscriptionId}.json`.
- This ID should remain stable when a project transcription is refreshed from a newer source version.
- Collation witnesses should store this ID when the witness source is a project transcription.

UI language:

- Usually hidden from users.
- Developer/debug UI may call it "Project transcription ID" or "Project link ID".

### Collation Witness Source

The transcription version a collation witness is pinned to.

Database representation:

- A row in `collation_witnesses`
- `project_transcription_id` identifies the project transcription link when available.
- `transcription_id` identifies the underlying project-owned transcription row.
- `source_revision_id` and `source_content_hash` pin the source version used by the witness.

Rules:

- Witnesses are pinned, not live references.
- Updating a project transcription must not silently update existing collation witnesses.
- Refreshing witness content is an explicit Subplan 4 action.

UI language:

- Prefer "Witness source".
- Use "Pinned source version" when explaining why witness text did not change automatically.

### Checkpoint

An intentional local commit of an entity's current working state.

Database representation:

- `transcription_checkpoints` for project transcriptions.
- `collation_checkpoints` for collations.
- `is_committed = 1` for committed checkpoints.
- Entity head fields point to the current checkpoint through `current_revision_id` and `current_content_hash`.

Rules:

- Autosave is not a checkpoint.
- A cloud backup uploads committed checkpoint content, not arbitrary autosaved working rows.
- A checkpoint may have a commit message or label.

UI language:

- Prefer "Committed version" in user-facing UI.
- "Checkpoint" is acceptable in developer-oriented UI or advanced history views.

### Working State

The latest local database state after edits and autosaves.

Rules:

- Working state can be dirty relative to the current checkpoint.
- Working state is local-only until committed.
- Working state should not be serialized to cloud primary/history files unless it exactly matches a committed checkpoint.

UI language:

- Prefer "Uncommitted changes".
- Keep autosave status separate from committed-version status.

### Cloud Backup

The committed project-contained files uploaded to a configured provider/folder.

Rules:

- Backup state should be derived from committed heads and `cloud_sync_metadata` for local status.
- Remote verification and restore completeness belong to later subplans.
- The first Subplan 1 API should not silently upload anything.
- `project.json` should be treated as the remote project manifest. It should summarize the current committed heads for project transcriptions, collations, and tombstones so the app can check remote freshness without downloading every entity primary file.
- A transcription or collation is up to date with a remote backup when its local committed checkpoint ID/content hash matches the corresponding entity head recorded in the last verified remote project manifest. Provider file revisions are transport metadata, not scholarly version identity.

UI language:

- Prefer "Cloud backup" or "Backed up".
- Avoid implying invisible autosync for upload behavior.

### Project Remote Location

The provider/folder where a project is backed up or can be restored from.

Database representation:

- `cloud_project_folders` links a local project to a provider connection and folder.
- `cloud_sync_metadata` records last-synced primary file metadata and committed heads.

Rules:

- A local project can have zero, one, or multiple remote locations.
- The project list should show the current provider/folder label for each linked location, or `Local only` when none exists.
- Polling a remote location should read the remote project manifest and update last-seen remote-head status; it should not apply changes until the user confirms a pull.

UI language:

- Prefer "Backup location" or "Remote backup".
- Use provider-specific labels such as `Dropbox: Apatosaurus/Projects/...` where helpful.

### Forked Project

A new project created by copying an existing project for experimentation or independent backup.

Rules:

- Forking creates a new project ID.
- The fork copies full project transcription data, collation data, checkpoints/history, and relevant metadata into the new project.
- The fork can be backed up to any provider/folder and can coexist with the source project in the same local database.

UI language:

- Prefer "Fork project" when the user wants an independent experiment.
- Prefer "Add backup location" only when the same project identity is intentionally linked to another provider/folder.

## Code Naming Guidelines

Use explicit names when both identity layers are present:

- `projectTranscriptionId` means `project_transcriptions.id`.
- `projectOwnedTranscriptionId` means the editable project-owned `transcriptions.id`.
- `snapshotTranscriptionId` may appear in existing code and migration helpers as a legacy alias for `projectOwnedTranscriptionId`; avoid introducing it in new public/UI-facing names.
- `libraryTranscriptionId` means a reusable library/global `transcriptions.id`.
- `canonicalTranscriptionId` means the reusable source stored on `project_transcriptions.canonical_transcription_id`.
- `sourceTranscriptionId` means the immediate source recorded in `transcriptions.origin_transcription_id`.
- `currentRevisionId` and `currentContentHash` mean the committed head on the entity row.
- `workingContentHash` means the hash recomputed from current local working rows.
- `pinnedRevisionId` and `pinnedContentHash` mean the version stored on a collation witness.

Avoid overloading `id` in new read models. Existing APIs like `ProjectTranscriptionOption.id` can remain unchanged for compatibility, but new status/read models should expose both identities.

## Target Read Models

The exact TypeScript shapes can evolve during implementation, but the APIs should carry these concepts.

### Project Transcription Status

Add a read model for project transcriptions, separate from `ProjectTranscriptionOption`.

Suggested type:

```ts
export interface ProjectTranscriptionStatus {
	projectId: string;
	projectTranscriptionId: string;
	projectOwnedTranscriptionId: string;
	siglum: string;
	title: string;
	description: string;
	isProjectOwned: boolean;
	canonicalSource: TranscriptionSourceSummary | null;
	immediateSource: TranscriptionOriginSummary | null;
	currentCheckpoint: EntityCheckpointHead | null;
	workingContentHash: string;
	dirtyToCheckpoint: boolean;
	commitState: 'never-committed' | 'clean' | 'dirty';
	sourceState: ProjectTranscriptionSourceState;
	cloudBackupState?: EntityCloudBackupState;
}
```

Supporting types:

```ts
export interface EntityCheckpointHead {
	revisionId: string;
	contentHash: string;
}

export interface TranscriptionSourceSummary {
	transcriptionId: string;
	scopeType: string;
	projectId: string | null;
	title: string;
	siglum: string;
	currentCheckpoint: EntityCheckpointHead | null;
	dirtyToCheckpoint: boolean | null;
}

export interface TranscriptionOriginSummary {
	sourceType: string;
	sourceProjectId: string | null;
	sourceTranscriptionId: string | null;
	sourceRevisionId: string | null;
	sourceContentHash: string | null;
}

export type ProjectTranscriptionSourceState =
	| { kind: 'no-source' }
	| { kind: 'source-missing'; sourceTranscriptionId: string }
	| { kind: 'source-has-no-committed-version'; sourceTranscriptionId: string }
	| { kind: 'up-to-date'; sourceTranscriptionId: string; sourceRevisionId: string; sourceContentHash: string }
	| { kind: 'newer-source-available'; sourceTranscriptionId: string; sourceRevisionId: string; sourceContentHash: string }
	| { kind: 'source-has-uncommitted-changes'; sourceTranscriptionId: string; sourceRevisionId: string | null; sourceContentHash: string | null };
```

Notes:

- `workingContentHash` should be computed using the same canonical payload logic used by checkpoint creation and cloud serialization.
- `commitState = 'never-committed'` if the project transcription has no `current_revision_id` or no `current_content_hash`.
- `dirtyToCheckpoint = true` when there is no committed head or when the recomputed working hash differs from `current_content_hash`.
- Source availability should compare the source committed head to the copy's recorded origin version when possible.
- If the source has local uncommitted changes, expose that explicitly instead of pretending there is a newer committed version.

### Collation Status

Add a read model for collation checkpoint and witness-source status.

Suggested type:

```ts
export interface CollationVersionStatus {
	projectId: string | null;
	collationId: string;
	title: string;
	verseIdentifier: string;
	workflowStatus: string;
	currentCheckpoint: EntityCheckpointHead | null;
	workingContentHash: string;
	dirtyToCheckpoint: boolean;
	commitState: 'never-committed' | 'clean' | 'dirty';
	witnesses: CollationWitnessSourceStatus[];
	cloudBackupState?: EntityCloudBackupState;
}

export interface CollationWitnessSourceStatus {
	witnessId: string;
	position: number;
	projectTranscriptionId: string | null;
	projectOwnedTranscriptionId: string | null;
	pinnedCheckpoint: EntityCheckpointHead | null;
	availableCheckpoint: EntityCheckpointHead | null;
	sourceDirtyToCheckpoint: boolean | null;
	versionState:
		| 'no-source'
		| 'source-missing'
		| 'source-has-no-committed-version'
		| 'pinned-current'
		| 'newer-source-available'
		| 'source-has-uncommitted-changes';
}
```

Notes:

- `pinnedCheckpoint` comes from `collation_witnesses.source_revision_id` and `source_content_hash`.
- `availableCheckpoint` comes from the current committed head of the linked project transcription.
- A witness with `project_transcription_id = null` should be treated as legacy or incomplete source metadata. Do not infer a refresh path unless the source can be resolved safely.
- A collation can be clean while one or more witnesses are stale. These are separate statuses.
- A collation can be dirty because witness metadata changed, collation tokens/readings changed, artifacts changed, or metadata changed.

### Cloud Backup State

Subplan 1 should provide local backup state only. It should not contact providers or perform remote verification. Later subplans add remote manifest polling; the local read models should still be ready to compare local committed heads with a manifest head supplied by a sync service.

Suggested type:

```ts
export interface EntityCloudBackupState {
	connectionId: string;
	projectId: string;
	entityType: 'project-transcription' | 'collation';
	entityId: string;
	status: 'not-configured' | 'never-backed-up' | 'backed-up' | 'committed-pending-backup' | 'remote-update-available' | 'uncommitted-local-changes' | 'unknown';
	lastSyncedRevision: string | null;
	lastSyncedHash: string | null;
	lastSeenRemoteRevision: string | null;
	lastSeenRemoteHash: string | null;
	lastSyncedAt: string | null;
	cloudPath: string | null;
}

export interface ProjectRemoteLocationStatus {
	projectId: string;
	connectionId: string;
	providerId: string;
	providerLabel: string;
	folderId: string;
	folderPath: string;
	lastFullySyncedAt: string | null;
	lastManifestRevision: string | null;
	lastManifestHash: string | null;
	status:
		| 'linked'
		| 'provider-unavailable'
		| 'pending-backup'
		| 'remote-update-available'
		| 'conflict-or-diverged'
		| 'unknown';
}
```

Derivation rules:

- If no connection/context is supplied, omit this field or return `not-configured`.
- If the entity is dirty, return `uncommitted-local-changes` even if the last committed head is backed up.
- If there is no committed head, return `never-backed-up` or `not-configured` depending on context.
- If `cloud_sync_metadata.last_synced_revision` and `last_synced_hash` match the local committed head, return `backed-up`.
- If a committed head exists but sync metadata is absent or stale, return `committed-pending-backup`.
- If a sync service supplies last-seen remote manifest heads and the remote entity head differs from the local committed head while local still matches the last synced head, return `remote-update-available`.
- If both local committed head and remote manifest head differ from the last synced head, return `unknown` or a conservative diverged state until later conflict UI exists.
- Remote conflicts and provider reachability should not be guessed by repository status reads. Later subplans can refine status after polling.
- Use committed checkpoint IDs plus content hashes as entity version identity. A monotonic manifest revision can be useful for quick polling, but the app should still compare entity checkpoint/hash pairs before declaring a transcription or collation up to date.

## Repository and Service Plan

### `app/src/lib/client/db/repositories/revisions.ts`

Add richer status helpers close to the existing checkpoint and hash logic.

Recommended additions:

- `getProjectTranscriptionCheckpointStatus(db, projectTranscriptionId)`
- `getCollationCheckpointStatus(db, collationId)`
- `getTranscriptionCommittedHead(db, transcriptionId)`
- `getCollationCommittedHead(db, collationId)`
- Internal shared helpers for computing transcription and collation working hashes.

Reasoning:

- `revisions.ts` already owns canonical payload hashing and checkpoint semantics.
- Keeping dirty/checkpoint derivation here prevents separate repositories from reimplementing hash logic.
- Existing `isTranscriptionDirty` and `isCollationDirty` can delegate to the richer helpers to avoid duplicate behavior.

Implementation notes:

- Preserve existing exported APIs for callers and tests.
- Return reasoned status objects rather than only booleans.
- Make missing committed head an explicit state, not an error.
- Continue throwing for missing entity IDs where the caller requested a specific entity.
- Keep committed-checkpoint lookups limited to `is_committed = 1` where checkpoint rows are loaded directly.

### `app/src/lib/client/db/repositories/projects.ts`

Add project transcription read models that expose both IDs and source status.

Recommended additions:

- `listProjectTranscriptionStatuses(db, projectId, options?)`
- `getProjectTranscriptionStatus(db, projectTranscriptionId, options?)`

The list query should join `project_transcriptions` to `transcriptions` and select:

- `project_transcriptions.id`
- `project_transcriptions.project_id`
- `project_transcriptions.transcription_id`
- `project_transcriptions.canonical_transcription_id`
- project-owned transcription `scope_type`, `origin_*`, `current_revision_id`, `current_content_hash`, title, siglum, description, and timestamps

Reasoning:

- The project repository already owns project membership and clone behavior.
- The existing `listProjectTranscriptionOptions` is shaped for picker UI and should not be overloaded with sync/version semantics.
- Later Subplans 2 and 3 need a project-level list of project transcriptions with stable link IDs.

Implementation notes:

- Include `projectOwnedTranscriptionId` and `projectTranscriptionId` in every new read model.
- Treat non-`project_snapshot` linked rows as anomalous but representable with `isProjectOwned = false` so UI can warn rather than crash.
- Do not auto-refresh or modify source metadata.
- Source status should be derived, not persisted.

### `app/src/lib/client/db/repositories/transcriptions.ts`

Add small identity/source summary helpers only if needed by the project status implementation.

Recommended additions:

- `getTranscriptionIdentitySummariesByIds(db, ids)`
- `getTranscriptionCommittedHeadsByIds(db, ids)` if this does not belong better in `revisions.ts`

Reasoning:

- Source status requires inspecting source transcriptions by ID.
- Keep broad transcription listing APIs scoped to library UI unless there is a concrete need to change them.

Implementation notes:

- Do not change `listTranscriptionSummaries`; it intentionally lists only global/library transcriptions.
- Be explicit about `scopeType` and `projectId` in new identity read models.

### `app/src/lib/client/db/repositories/collations.ts`

Add collation status read models that expose dirty state and witness source status.

Recommended additions:

- `getCollationVersionStatus(db, collationId, options?)`
- `listProjectCollationVersionStatuses(db, projectId, options?)`
- `getCollationWitnessSourceStatuses(db, collationId)` as an internal helper if useful.

Reasoning:

- The collation repository already owns witness rows and projection loading.
- Later witness refresh UI needs a direct way to show pinned versus available versions.

Implementation notes:

- Extend internal projection/witness loading to include `project_transcription_id` and `source_content_hash`; the current public `CollationProjectionRecord.witnesses` only exposes `sourceVersion`.
- Do not change save behavior in this subplan.
- Keep legacy/incomplete witnesses visible with explicit status rather than filtering them out.

### `app/src/lib/client/sync/sync-manager.ts`

Use existing metadata derivation where it fits, but avoid remote operations in Subplan 1.

Recommended additions:

- A local-only helper to derive `EntityCloudBackupState` from a `SyncProjectContext`, entity reference, committed head, dirty state, and `cloud_sync_metadata`.
- Alternatively, keep this derivation inside repository/service APIs until Subplan 5 builds the project backup panel.

Reasoning:

- Cloud backup status is partly sync-domain logic.
- But Subplan 1 should not make status reads perform provider network I/O.

Implementation notes:

- Reuse `deriveLocalSyncUiState` semantics where practical.
- Do not call `publishEntity`, `pollOpenEntity`, or provider methods from status read APIs.

### `app/src/lib/client/collation/project-collation.ts`

Expose friendly service wrappers for project-level UI.

Recommended additions:

- `listProjectTranscriptionStatuses(projectId)`
- `getProjectTranscriptionStatus(projectTranscriptionId)`
- `listProjectCollationVersionStatuses(projectId)`
- `getCollationVersionStatus(collationId)`

Reasoning:

- This module already provides project/collation-oriented client functions to the UI.
- Keeping UI code away from raw DB client request names makes later UI implementation cleaner.

### `app/src/lib/client/db/client.ts`

Add typed client functions for any new worker RPC requests.

Recommended additions:

- `listProjectTranscriptionStatuses(projectId, options?)`
- `getProjectTranscriptionStatus(projectTranscriptionId, options?)`
- `listProjectCollationVersionStatuses(projectId, options?)`
- `getCollationVersionStatus(collationId, options?)`

Implementation notes:

- Keep request/response types imported from repository files.
- Match existing patterns for `sendProjectRequest`, `sendCollationRequest`, and `sendRevisionRequest`.

### `app/src/lib/client/db/rpc.ts`

Add request/response types for the new read models.

Potential request names:

- `projects.listTranscriptionStatuses`
- `projects.getTranscriptionStatus`
- `collations.listProjectVersionStatuses`
- `collations.getVersionStatus`

Reasoning:

- These are read models, so they fit the existing worker RPC boundary.
- Keeping names explicit avoids confusion with existing picker/list APIs.

### `app/src/lib/client/db/db.worker.ts`

Wire the new RPC requests to repository functions.

Implementation notes:

- These are read-only operations and should not post invalidation events.
- If status helpers compute hashes, expect them to be async.
- Preserve the existing invalidation behavior for commit/save operations.

## Detailed Derivation Rules

### Project Transcription Dirty State

For a project transcription:

1. Load the project-owned transcription row through `project_transcriptions.id`.
2. Compute the canonical working hash using `buildTranscriptionHashPayload` and `hashCanonicalPayload`.
3. Load the project-owned transcription row's `current_revision_id` and `current_content_hash`.
4. If either committed-head field is empty, return `commitState = 'never-committed'` and `dirtyToCheckpoint = true`.
5. If the working hash differs from `current_content_hash`, return `commitState = 'dirty'` and `dirtyToCheckpoint = true`.
6. Otherwise return `commitState = 'clean'` and `dirtyToCheckpoint = false`.

Reasoning:

- This matches the existing `isTranscriptionDirty` behavior.
- It also gives UI the checkpoint ID/hash needed for labels and backup status.

### Project Transcription Source State

For a project transcription:

1. Determine the best source ID.
2. Prefer `project_transcriptions.canonical_transcription_id` for canonical source summaries.
3. Also expose the immediate origin from the project-owned transcription row's `origin_*` fields.
4. If no source ID exists, return `no-source`.
5. If the source row is missing, return `source-missing`.
6. If the source has no committed head, return `source-has-no-committed-version`.
7. If the source has a committed head but its current working hash differs from that head, return `source-has-uncommitted-changes`.
8. If the source committed head equals the project transcription's recorded origin revision/hash, return `up-to-date`.
9. Otherwise return `newer-source-available`.

Reasoning:

- A project transcription should not silently change when source material changes.
- Later refresh UI needs to distinguish committed source updates from source drafts.
- Missing or uncommitted source state should be visible and non-fatal.

Open implementation nuance:

- Global/library source checkpointing is not yet as explicit as project transcription checkpointing. If a library source has no committed head, surface that fact rather than inventing one. Subplan 2 or 3 can decide whether library transcriptions need their own commit action or whether refresh is limited to committed project/library rows that already have heads.

### Collation Dirty State

For a collation:

1. Load the serialized collation through `loadSerializedCollation`.
2. Compute the canonical working hash using `buildCollationHashPayload` and `hashCanonicalPayload`.
3. Load `collations.current_revision_id` and `current_content_hash`.
4. If either committed-head field is empty, return `commitState = 'never-committed'` and `dirtyToCheckpoint = true`.
5. If the working hash differs from `current_content_hash`, return `commitState = 'dirty'` and `dirtyToCheckpoint = true`.
6. Otherwise return `commitState = 'clean'` and `dirtyToCheckpoint = false`.

Reasoning:

- This matches the existing `isCollationDirty` behavior.
- It makes the state explainable before cloud serialization rejects a dirty collation.

### Collation Witness Source State

For each collation witness:

1. Read `witness_id`, `position`, `project_transcription_id`, `transcription_id`, `source_revision_id`, and `source_content_hash`.
2. Treat `source_revision_id` and `source_content_hash` as the pinned checkpoint head.
3. If neither project nor transcription source is available, return `no-source`.
4. If `project_transcription_id` is present, load the linked project transcription and its committed head.
5. If the linked source is missing, return `source-missing`.
6. If the linked source has no committed head, return `source-has-no-committed-version`.
7. If the linked source is dirty to its committed head, return `source-has-uncommitted-changes`.
8. If the linked source committed head equals the pinned head, return `pinned-current`.
9. Otherwise return `newer-source-available`.

Reasoning:

- Collation witness version status is independent of collation dirty status.
- Existing collations must remain pinned until the user chooses to refresh.
- Later Subplan 4 needs this exact distinction to decide whether to show refresh actions.

### Cloud Backup State

For a project transcription or collation with an optional sync context:

1. If no sync context is provided, return no backup state or `not-configured`.
2. If the entity is dirty to checkpoint, return `uncommitted-local-changes`.
3. If there is no committed head, return `never-backed-up`.
4. Look up matching `cloud_sync_metadata` by connection, project scope, entity type, and entity ID.
5. If no metadata exists, return `committed-pending-backup`.
6. If metadata `last_synced_revision` and `last_synced_hash` match the current committed head, return `backed-up`.
7. Otherwise return `committed-pending-backup`.

Reasoning:

- This is a local status only.
- It tells UI when cloud backup is blocked by uncommitted changes versus simply pending upload.
- It does not claim remote restore safety; Subplan 8 will define safe local removal.

## Implementation Sequence

1. Add vocabulary/status types near the repositories that return them.
2. Add richer checkpoint status helpers in `revisions.ts` and refactor existing dirty boolean helpers to delegate to them.
3. Add project transcription status queries in `projects.ts`.
4. Add transcription identity/source summary helpers if needed.
5. Add collation version and witness source status queries in `collations.ts`.
6. Add local cloud backup status derivation if a sync context can be supplied cleanly without network I/O.
7. Add RPC map entries in `rpc.ts`.
8. Add client wrappers in `client.ts`.
9. Wire read-only handlers in `db.worker.ts`.
10. Add service wrappers in `project-collation.ts` for future UI use.
11. Add focused repository tests.
12. Run type, database, and targeted test verification.

## File-by-File Work Breakdown

### `app/src/lib/client/db/repositories/revisions.ts`

Planned changes:

- Introduce `EntityCheckpointHead`, `EntityCheckpointStatus`, or similarly named shared types.
- Add a rich project transcription checkpoint status function.
- Add a rich collation checkpoint status function.
- Keep `isTranscriptionDirty` and `isCollationDirty`, but implement them by returning `.dirtyToCheckpoint` from the richer status helpers.
- Consider adding non-throwing committed-head helpers for source rows where missing heads are valid status outcomes.

Important constraints:

- Do not alter checkpoint payload format.
- Do not alter hash payload builders except to share code.
- Ensure status functions use the same canonical hash payloads as checkpoint creation and cloud serialization.

### `app/src/lib/client/db/repositories/projects.ts`

Planned changes:

- Add a new project transcription status type.
- Add `listProjectTranscriptionStatuses`.
- Add `getProjectTranscriptionStatus`.
- Join project links to project-owned transcription rows and source rows where useful.
- Preserve `listProjectTranscriptionOptions` behavior.

Important constraints:

- New models must expose both `projectTranscriptionId` and `projectOwnedTranscriptionId`.
- Do not refresh, commit, or mutate project transcriptions from status APIs.
- Do not hide anomalous rows; return explicit status where possible.

### `app/src/lib/client/db/repositories/transcriptions.ts`

Planned changes:

- Add source identity summary helpers only if needed to avoid duplicating source-row queries in `projects.ts`.
- Keep global/library list APIs unchanged.

Important constraints:

- Avoid widening `listTranscriptionSummaries` to include project-owned transcriptions.
- Avoid renaming existing public types in this subplan.

### `app/src/lib/client/db/repositories/collations.ts`

Planned changes:

- Add a status read model for collation version state.
- Add witness source status derivation.
- Extend or add internal witness loading so status APIs can see pinned source hashes and project link IDs.
- Preserve `loadCollation` and `CollationProjectionRecord` compatibility unless a safe additive field is necessary.

Important constraints:

- Do not update witness metadata incidentally.
- Do not refresh witness content.
- Treat `collations.project_id = null` as legacy/incomplete for project workflows but do not require a migration in this subplan.

### `app/src/lib/client/db/rpc.ts`

Planned changes:

- Import new response types.
- Add project and collation RPC request/response entries.

Important constraints:

- Keep request names explicit and non-overlapping with existing picker/list functions.

### `app/src/lib/client/db/client.ts`

Planned changes:

- Add typed wrappers that call the new RPC entries.
- Export them for service/UI use.

Important constraints:

- Do not expose raw SQL or low-level hash helpers to components.

### `app/src/lib/client/db/db.worker.ts`

Planned changes:

- Add read-only handlers for the new RPC requests.
- Do not emit invalidation events for these reads.

### `app/src/lib/client/collation/project-collation.ts`

Planned changes:

- Re-export or wrap the new project transcription and collation status APIs.
- Keep existing `listTranscriptions` behavior for selection UI.

Important constraints:

- Do not change the shape of current project picker options.

## Testing Plan

Add or extend tests in the existing repository test files.

### Project Transcription Status Tests

Target files:

- `app/src/lib/client/db/repositories/projects.spec.ts`
- `app/src/lib/client/db/repositories/revisions.spec.ts`

Cases:

- A newly created project transcription exposes both `projectTranscriptionId` and `projectOwnedTranscriptionId`.
- A newly created project transcription with no committed head returns `commitState = 'never-committed'` and `dirtyToCheckpoint = true`.
- After `createCommittedTranscriptionCheckpoint`, an unchanged project transcription returns `commitState = 'clean'` and `dirtyToCheckpoint = false`.
- After editing the project-owned transcription row, the same project transcription returns `commitState = 'dirty'` and includes a changed `workingContentHash`.
- A project transcription created from a committed source records the origin revision/hash.
- If the source committed head still matches the recorded origin, source state is `up-to-date`.
- If the source committed head differs from the recorded origin, source state is `newer-source-available`.
- If the source has no committed head, source state is `source-has-no-committed-version`.
- If the source row is missing, source state is `source-missing`.

### Collation Status Tests

Target files:

- `app/src/lib/client/db/repositories/collations.spec.ts`
- `app/src/lib/client/db/repositories/revisions.spec.ts`

Cases:

- A new collation with no committed head returns `commitState = 'never-committed'` and `dirtyToCheckpoint = true`.
- After `createCommittedCollationCheckpoint`, an unchanged collation returns `commitState = 'clean'`.
- After changing projection or metadata, the collation returns `commitState = 'dirty'`.
- A witness whose pinned source equals the project transcription committed head returns `pinned-current`.
- A witness whose project transcription has a newer committed head returns `newer-source-available`.
- A witness whose project transcription has uncommitted changes returns `source-has-uncommitted-changes`.
- A witness with no source metadata returns `no-source` or a legacy/incomplete status.
- A missing linked source returns `source-missing`.

### RPC and Client Tests

If existing test harnesses cover worker RPC, add smoke tests for:

- `projects.listTranscriptionStatuses`
- `projects.getTranscriptionStatus`
- `collations.listProjectVersionStatuses`
- `collations.getVersionStatus`

If worker tests are not currently practical, rely on repository tests plus `bun run check` for typed client/RPC coverage.

## Verification Commands

Run from `app/` after implementation:

```sh
bun run check
bun run db:check
```

Run targeted tests after repository changes. Exact command names should follow the repo's test scripts, but the priority targets are:

- `src/lib/client/db/repositories/projects.spec.ts`
- `src/lib/client/db/repositories/revisions.spec.ts`
- `src/lib/client/db/repositories/collations.spec.ts`
- Any worker/RPC tests if present

## Acceptance Criteria

- New read models expose both project transcription link IDs and project-owned transcription row IDs.
- Existing picker/list APIs continue to work unchanged.
- Project transcription status reports committed head, working hash, dirty state, source provenance, and source availability.
- Collation status reports committed head, working hash, dirty state, and per-witness pinned versus available source versions.
- Local backup state can be derived without provider network calls when sync context is available.
- Status APIs do not mutate project, transcription, collation, checkpoint, witness, or sync rows.
- Existing dirty boolean helpers still behave as before.
- Unit tests cover clean, dirty, never-committed, missing-source, newer-source, and stale-witness cases.
- `bun run check` and `bun run db:check` pass from `app/`.

## Risks and Mitigations

### Risk: Status Computation Becomes Expensive

Computing canonical hashes for many project transcriptions or collations can be expensive because it serializes related rows.

Mitigation:

- Start with correctness.
- Batch simple row loading where practical.
- Avoid provider network calls.
- If project lists become slow, add a later optimization that computes expensive hashes lazily for expanded rows or detail panels.

### Risk: Global/Library Source Commit Semantics Are Incomplete

Project transcription checkpoint creation currently targets `projectTranscriptions.id`, while source rows can be global/library rows.

Mitigation:

- Surface `source-has-no-committed-version` honestly.
- Do not invent committed source state.
- Let Subplan 2 or Subplan 3 decide whether library transcriptions need explicit commit support.

### Risk: Legacy Witness Rows Lack `project_transcription_id`

Some witness rows may only have `transcription_id` or incomplete pinned metadata.

Mitigation:

- Return explicit incomplete/legacy status rather than crashing.
- Do not infer refresh actions that could bind to the wrong project transcription.
- Future migration or repair UI can be planned separately if needed.

### Risk: UI Uses Transcription Row IDs Where Stable Link IDs Are Required

Current project UI mostly sees `transcription_id` values.

Mitigation:

- Keep old APIs for selection.
- Add new APIs with unambiguous names.
- Use `projectTranscriptionId` in all future sync/version/refresh actions.

### Risk: Cloud Backup Status Is Overstated

Local `cloud_sync_metadata` can say what was last synced locally, but it cannot prove the remote file still exists or is restorable.

Mitigation:

- Name the Subplan 1 state as local backup metadata, not safe-to-remove proof.
- Reserve remote verification and safe local removal for Subplans 6 and 8.

## Dependencies for Later Subplans

Subplan 2 depends on:

- Project transcription status exposing `projectTranscriptionId` for commit actions.
- Dirty-to-checkpoint state for project transcriptions and collations.
- Committed head summaries for UI labels.

Subplan 3 depends on:

- Project transcription source provenance.
- Source committed head availability.
- Stable `projectTranscriptionId` preservation.

Subplan 4 depends on:

- Witness pinned source status.
- Available project transcription committed head per witness.
- Collation dirty-to-checkpoint state after refresh.

Subplan 5 depends on:

- Dirty entities being identifiable before backup.
- Committed-not-backed-up state being derivable from local metadata.
- Stable entity IDs for project-contained cloud paths.

Subplan 8 depends on:

- Clear separation between local dirty state, committed state, and backup metadata.

## Open Questions

No blocking questions are required to implement this subplan. The main design assumption is that Subplan 1 should surface the current reality rather than resolve every workflow gap.

Questions to revisit during later subplans:

- Should library transcriptions get their own explicit commit UI, or should project refresh only use committed project transcriptions and any library rows that already have committed heads?
- Should status APIs eagerly compute hashes for every row in large project lists, or should UI request expensive detail status lazily?
- Should legacy collation witnesses without `project_transcription_id` get a repair flow before witness refresh is enabled?

## Final Recommended First Implementation Slice

For the first coding pass, implement the smallest complete foundation:

1. Rich dirty/checkpoint status helpers in `revisions.ts`.
2. `listProjectTranscriptionStatuses` and `getProjectTranscriptionStatus` in `projects.ts`.
3. RPC/client wrappers for those project transcription statuses.
4. Repository tests proving both IDs, clean/dirty/never-committed states, and source availability.

Then add the collation status read model as the second slice of the same subplan. This keeps the first pull request reviewable while still preserving the architecture direction.
