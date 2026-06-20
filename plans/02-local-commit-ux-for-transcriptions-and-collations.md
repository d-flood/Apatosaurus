# Subplan 2: Local Commit UX for Transcriptions and Collations

## Selection Rationale

This is the correct next subplan after `plans/01-domain-vocabulary-and-status-apis.md` because local commits are the intentional version boundary that all later project refresh, witness refresh, and cloud backup workflows depend on.

The current app already autosaves transcription and collation working state. It also already has repository and RPC primitives for creating committed checkpoints. What is missing is the user-facing layer that explains the difference between autosaved working edits and committed versions, then lets the user intentionally create those committed versions.

## Goal

Separate autosave from intentional local version creation in the UI.

The desired outcome is that users can see and control two independent states:

- Autosave state: whether the latest local working edits have been written to SQLite.
- Committed-version state: whether the local working state has been intentionally checkpointed as a version.

After this subplan, project transcriptions and collations should have explicit local commit actions. Cloud backup should be blocked or clearly warned when an entity has uncommitted working changes.

## Non-Goals

- Do not implement project transcription refresh from source. That belongs to Subplan 3.
- Do not implement collation witness refresh. That belongs to Subplan 4.
- Do not implement project-level backup orchestration. That belongs to Subplan 5.
- Do not implement cloud project restore. That belongs to Subplan 6.
- Do not change the cloud file format.
- Do not treat autosave as a cloud backup trigger.
- Do not add schema fields for draft state unless implementation proves the existing checkpoint tables are insufficient. The expected implementation uses the existing checkpoint schema.

## Current Grounding

### Existing Checkpoint Primitives

`app/src/lib/client/db/repositories/revisions.ts` already provides the core repository functions:

- `createCommittedTranscriptionCheckpoint(db, input)`
- `createCommittedCollationCheckpoint(db, input)`
- `isTranscriptionDirty(db, projectTranscriptionId)`
- `isCollationDirty(db, collationId)`

The checkpoint functions already:

- Build canonical hash payloads.
- Insert rows into `transcription_checkpoints` or `collation_checkpoints`.
- Mark the checkpoint as committed with `is_committed = 1`.
- Store optional `commit_message` and `author_name`.
- Update `transcriptions.current_revision_id` / `current_content_hash` or `collations.current_revision_id` / `current_content_hash`.
- Preserve parent checkpoint lineage through `parent_checkpoint_id`.

`app/src/lib/client/db/client.ts` already exposes client wrappers:

- `createCommittedTranscriptionCheckpoint(input)`
- `createCommittedCollationCheckpoint(input)`
- `isTranscriptionDirty(projectTranscriptionId)`
- `isCollationDirty(collationId)`

`app/src/lib/client/db/rpc.ts` and `app/src/lib/client/db/db.worker.ts` already wire these operations through the worker boundary.

### Existing Transcription Autosave

`app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte` contains a debounced autosave path:

- `createDebouncedAutosave` schedules persistence after edits.
- `persist` calls `updateTranscriptionContent` with the current `transcriptions.id`.
- `persist` serializes the document with `serializeTranscriptionDocument`.
- `persist` also calls `externalSyncService.enqueueSync`, which is separate from the project cloud backup model.
- `flushAutosave` exists as a local constant inside the component, but is not exposed to the route.

`app/src/routes/transcription/[id]/+page.svelte` displays a shallow autosave state:

- `hasUnsavedChanges` is updated through `onSaveStateChange` from `TranscriptionEditor`.
- The header shows `Unsaved changes` while autosave is pending.
- Once autosave completes, the header shows `Saved just now` or relative saved time based on `transcription.updated_at`.

Important limitation:

- The route is keyed by `transcriptions.id`, not by `project_transcriptions.id`.
- The commit primitive requires `projectTranscriptionId`, which means project-aware context must be loaded before transcription commit UI can be shown.

### Existing Collation Autosave

`app/src/lib/client/collation/collation-state.svelte.ts` maintains `saveStatus` as `saved`, `saving`, `unsaved`, or `error`.

Current persistence flow:

- `markUnsaved` sets `saveStatus = 'unsaved'` and schedules save.
- `scheduleSave` debounces `persistDocument` by 800ms.
- `persistDocument` writes the canonical collation document artifact through `saveCollationArtifact`.
- If the collation is finalized, `persistDocument` materializes projection rows through `saveCollationProjection`.
- `persistDocument` updates collation metadata status and `updatedAt` through `updateCollationMetadata`.

`app/src/lib/components/collation/AutoSaveIndicator.svelte` displays only the autosave state.

`app/src/lib/components/collation/CollationWorkspace.svelte` places `AutoSaveIndicator` in the header next to `CollationStepper`.

Important limitation:

- There is no public `flushPendingSave` method on `collationState`. A commit action could otherwise checkpoint stale data while a debounced autosave is still pending.

### Current Witness Auto-Refresh Conflict

`collation-state.svelte.ts` currently calls `refreshChangedWitnessSourcesAfterLoad(id)` after loading a collation. That function can refresh witness source text after load, mark the collation `unsaved`, and schedule a save.

This conflicts with the architecture decision that collation witnesses should stay pinned until a user explicitly refreshes them. Subplan 4 will add explicit witness refresh UI. For Subplan 2, the commit UX must not hide or normalize this behavior. The implementation should either avoid expanding this auto-refresh path or remove/gate it before relying on committed collation versions as intentional user choices.

## Product Semantics

### Autosave

Autosave means the latest working state has been persisted locally to SQLite.

Autosave does not mean:

- A checkpoint exists.
- The entity is safe to upload.
- The entity is backed up.
- Other projects or collations should update.

Recommended UI language:

- `Saved locally`
- `Saving locally`
- `Unsaved local edits`
- `Local save failed`

### Local Commit

A local commit means the current working state was intentionally checkpointed as a local version.

A local commit does not mean:

- The version was uploaded to cloud storage.
- The version is conflict-free with a remote copy.
- Other project transcriptions or collation witnesses should update.

Recommended UI language:

- `Commit version`
- `Committed version`
- `Changes since commit`
- `No committed version yet`

Avoid using `Save` for the commit action because autosave already saves working rows.

### Cloud Backup Block

Cloud backup should not upload uncommitted working state.

For this subplan, the UI should show one of these states where cloud backup actions or indicators exist:

- `Commit changes before backup`
- `Backup pending for committed version`
- `Backed up` if local metadata proves the current committed head was synced
- `Local-only` if no cloud connection/context is available

Subplan 5 will turn this into full project-level backup orchestration. Subplan 2 only needs to prevent the UI from implying dirty working state is upload-ready.

## UX Requirements

### Shared Requirements

- Show autosave state and committed-version state separately.
- Do not replace the existing autosave indicator with a commit indicator.
- Disable commit while autosave is actively saving.
- Flush pending autosave before creating a checkpoint.
- If the flush fails, do not create a checkpoint.
- Allow an optional commit message or label.
- Treat a blank commit message as `null`, matching the existing checkpoint schema.
- Show the newly created checkpoint after commit.
- Refresh dirty/status read models after commit.
- Disable the commit button when the entity is clean relative to the current checkpoint.
- Enable the commit button when there is no committed checkpoint yet.
- Enable the commit button when there are changes since the current checkpoint.
- Show a clear error if committing fails.
- Do not trigger cloud upload from the commit action.

### Transcription UX

For project transcriptions, add a local commit control near the transcription page header or sticky toolbar.

The control should show:

- Autosave state from `hasUnsavedChanges` and the editor save callback.
- Version state from Subplan 1's project transcription status.
- The current committed checkpoint ID or a short label if present.
- `No committed version yet` when the copy has no checkpoint.
- `Changes since commit` when dirty-to-checkpoint is true.
- `Committed` when clean-to-checkpoint is true.

The commit action should:

- Be visible only when the open transcription is project-owned.
- Be hidden or disabled with explanation for library transcriptions.
- Resolve `projectTranscriptionId` from the open project-owned `transcriptions.id`.
- Flush pending editor autosave before committing.
- Call `createCommittedTranscriptionCheckpoint({ projectTranscriptionId, commitMessage })`.
- Refresh transcription status and page data after success.
- Reset or update local version-state UI after success.

Suggested UI text:

- Button: `Commit version`
- Dialog title: `Commit transcription version`
- Empty message helper: `Optional note for this local version.`
- Success: `Committed locally`
- Clean disabled tooltip: `No changes since the last committed version.`
- Library disabled tooltip: `Only project transcriptions can be committed for project backup.`

### Collation UX

For collations, add a local commit control to `CollationWorkspace.svelte` near `AutoSaveIndicator`.

The control should show:

- Existing autosave state from `collationState.saveStatus`.
- Version state from Subplan 1's collation status read model.
- `No committed version yet` when the collation has no checkpoint.
- `Changes since commit` when dirty-to-checkpoint is true.
- `Committed` when clean-to-checkpoint is true.

The commit action should:

- Be available only after a `collationId` exists.
- Flush pending collation save before committing.
- Call `createCommittedCollationCheckpoint({ collationId, commitMessage })`.
- Refresh collation version status after success.
- Keep the user in the current collation phase.
- Not advance workflow phase or change witness source versions.

Suggested UI text:

- Button: `Commit version`
- Dialog title: `Commit collation version`
- Success: `Committed locally`
- Clean disabled tooltip: `No changes since the last committed version.`
- Autosave pending tooltip: `Finish local save before committing.`

## Data and API Plan

### Dependency on Subplan 1

The ideal Subplan 2 implementation consumes these read models from Subplan 1:

- Project transcription status by `projectTranscriptionId`.
- Project transcription status by project-owned `transcriptions.id` or a mapping from transcription row ID to project link ID.
- Collation version status by `collationId`.
- Dirty-to-checkpoint status and current committed head for both entity types.

If Subplan 2 is implemented before all of Subplan 1 is complete, add only the smallest missing read helper needed to map the transcription route's `transcriptions.id` to `project_transcriptions.id`. Do not duplicate the full status model in components.

### Commit Request Shapes

Use the existing input types from `revisions.ts`:

```ts
export interface CommitTranscriptionInput {
	projectTranscriptionId: string;
	checkpointId?: string;
	commitMessage?: string | null;
	authorName?: string;
	createdAt?: string;
}

export interface CommitCollationInput {
	collationId: string;
	checkpointId?: string;
	commitMessage?: string | null;
	authorName?: string;
	createdAt?: string;
}
```

Implementation notes:

- UI should pass `commitMessage: trimmedMessage || null`.
- UI should not pass `checkpointId` or `createdAt`; those are for tests/imports.
- `authorName` can remain omitted until the product has user/profile identity.

### Optional Service Wrappers

Add thin wrappers if they reduce component complexity:

- `commitProjectTranscription(input)` in `project-collation.ts` or a new local versioning service.
- `commitCollationVersion(input)` in `project-collation.ts` or a new local versioning service.

Wrappers should:

- Call existing DB client functions.
- Return the checkpoint.
- Not perform autosave flushing, because flushing is editor/state specific.
- Not perform cloud upload.

## Implementation Plan

### 1. Ensure Status Read Models Exist

Before UI work, confirm Subplan 1 provides status for:

- Open project transcription by project-owned transcription row ID.
- Open collation by collation ID.

If missing, add minimal read-only support:

- `getProjectTranscriptionStatusForOwnedTranscription(projectOwnedTranscriptionId)`
- `getCollationVersionStatus(collationId)`

Reasoning:

- The transcription route currently only knows `page.params.id`, which is the project-owned `transcriptions.id` when editing project transcription data.
- The commit function requires `project_transcriptions.id`.
- Components should not infer status by issuing raw SQL or calling dirty boolean helpers alone.

### 2. Expose Transcription Autosave Flush

Modify `TranscriptionEditor.svelte` so the parent route can flush pending autosave before committing.

Recommended minimal approach:

- Expose an imperative method such as `flushPendingAutosave` from the component.
- Keep the existing debounced autosave implementation.
- The method should clear any pending timeout and await `flushAutosave()`.
- It should resolve only after pending persistence completes.
- It should report failure if persistence fails, either by throwing or returning `false`.

Reasoning:

- Without this, a commit button in the route could checkpoint the previous persisted row while the editor still has unsaved changes in memory.
- Waiting for `hasUnsavedChanges` to become false after a click is too indirect and fragile.

Implementation caution:

- The current `flush` returns early if `saveInFlight` is true. Commit UX should not race with an in-flight save. If needed, extend the autosave helper so `flushPendingAutosave` waits for in-flight persistence to settle.

### 3. Add Transcription Commit State to Route

Modify `app/src/routes/transcription/[id]/+page.svelte`.

Planned state:

- `transcriptionVersionStatus`
- `isCommitDialogOpen`
- `commitMessage`
- `commitInFlight`
- `commitError`
- `transcriptionEditorRef` or equivalent for autosave flush

Planned behavior:

- Load version status after loading transcription.
- Reload version status on `transcriptions` invalidation.
- If no project transcription status exists, treat the open transcription as non-project/library for commit UI.
- On commit click, open a small dialog or inline form for optional message.
- On confirm, flush pending editor autosave.
- If flush succeeds, call `createCommittedTranscriptionCheckpoint` with the resolved `projectTranscriptionId`.
- Refresh transcription and version status after commit.
- Close dialog and clear message after success.

UI placement:

- Add the commit control to the existing centered page header near the save text, or to the sticky toolbar header.
- Prefer the sticky toolbar if the button should remain available during editing.
- Keep the page header save text simple; do not overload it with all version details.

### 4. Add Collation Save Flush Method

Modify `app/src/lib/client/collation/collation-state.svelte.ts`.

Add a public method such as:

```ts
async function flushPendingSave(): Promise<boolean>;
```

Expected behavior:

- If `saveTimeout` exists, clear it and set it to null.
- If there is no `collationId`, return false or throw a clear error.
- If already saving, wait for the in-flight save to finish rather than starting a concurrent save.
- If status is `unsaved`, run `persistDocument` immediately.
- If persistence succeeds, set `saveStatus = 'saved'`.
- If persistence fails, set `saveStatus = 'error'` and return false or throw.

Implementation detail:

- The current `persistDocument` catches errors and sets `saveStatus = 'error'`, but does not rethrow. For commit UX, add a way to know whether it succeeded.
- A minimal change is for `persistDocument` to return `boolean` while preserving current callers.

### 5. Add Collation Commit Method or Component Handler

Use the existing `createCommittedCollationCheckpoint` client wrapper.

Implementation options:

- Keep commit logic in `CollationWorkspace.svelte`.
- Or add `collationState.commitCurrentVersion(commitMessage)` that flushes and commits.

Preferred first implementation:

- Add `flushPendingSave` to `collationState`.
- Keep the checkpoint call in `CollationWorkspace.svelte` or a small child component.

Reasoning:

- `collationState` should own workspace persistence.
- The component should own the commit dialog and user interaction.
- Avoid growing the state object with UI-specific dialog/error state.

### 6. Add Shared Commit UI Only if Worth It

A shared component can reduce duplication, but do not over-abstract prematurely.

Potential component:

- `app/src/lib/components/versioning/CommitVersionControl.svelte`

Props might include:

- `entityLabel`
- `status`
- `autosaveState`
- `disabledReason`
- `onCommit`

Recommendation:

- Start with inline controls in the transcription page and collation workspace if that is smaller.
- Extract shared UI only after both controls have nearly identical markup.

### 7. Backup Guard and Status Messaging

Where a cloud backup action is already present or introduced before Subplan 5, gate it on committed-version state.

Rules:

- If autosave is pending, block backup with `Finish saving locally before backup.`
- If dirty-to-checkpoint, block backup with `Commit changes before backup.`
- If no checkpoint exists, block backup with `Commit a version before backup.`
- If clean and committed, allow backup or mark it `ready for backup`.

Current likely touchpoints:

- `app/src/lib/components/SyncStatusIndicator.svelte`
- `app/src/lib/components/CloudConnectButton.svelte`
- Future Subplan 5 project backup panel

Subplan 2 should not add a full project backup panel. It should only avoid contradictory UI if backup actions already appear on edited pages.

## File-by-File Work Breakdown

### `app/src/lib/client/db/repositories/revisions.ts`

Planned changes:

- Reuse existing commit functions.
- If Subplan 1 status helpers exist, ensure they are refreshed correctly after commit.
- Keep existing `isTranscriptionDirty` and `isCollationDirty` behavior intact.

Possible small addition:

- A helper returning the new checkpoint plus recomputed entity status, if that simplifies UI refresh.

Avoid:

- Changing checkpoint payload format.
- Changing parent checkpoint semantics.
- Automatically creating checkpoints during autosave.

### `app/src/lib/client/db/client.ts`

Planned changes:

- Existing commit wrappers are already present.
- Add imports/wrappers only for missing status read models from Subplan 1.

### `app/src/lib/client/db/rpc.ts`

Planned changes:

- Existing commit RPC entries are already present.
- Add missing status read RPC entries only if not already completed by Subplan 1.

### `app/src/lib/client/db/db.worker.ts`

Planned changes:

- Existing commit handlers already post invalidations for `transcriptions` and `collations`.
- Add missing read-only status handlers only if needed.
- Ensure commit invalidations cause UI status reloads.

### `app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte`

Planned changes:

- Expose a parent-callable `flushPendingAutosave` method.
- Ensure the flush waits for pending or in-flight saves.
- Preserve existing `onSaveStateChange` behavior.

Avoid:

- Moving commit logic into the editor component.
- Adding project-specific concepts to the editor internals beyond exposing save flush.

Reasoning:

- The editor should persist transcription content.
- The route should decide whether the opened transcription is project-owned and whether commit UI applies.

### `app/src/routes/transcription/[id]/+page.svelte`

Planned changes:

- Load project transcription/version status for the opened `transcriptionId`.
- Render commit-version state for project transcriptions.
- Add optional commit message dialog or inline form.
- Flush editor autosave before calling `createCommittedTranscriptionCheckpoint`.
- Refresh status and transcription data after commit.

Avoid:

- Showing commit UI for library/global transcriptions unless a later decision adds library commit semantics.
- Calling checkpoint APIs with `transcriptions.id` instead of `project_transcriptions.id`.

### `app/src/lib/client/collation/collation-state.svelte.ts`

Planned changes:

- Add a public `flushPendingSave` method.
- Make internal persistence return success/failure in a way commit UX can use.
- Track in-flight save promise if needed to avoid concurrent persistence.

Potential cleanup:

- Stop auto-refreshing changed witness sources after load, or clearly gate it so Subplan 2 commit status is not surprised by implicit witness refresh.

Avoid:

- Creating committed checkpoints inside `markUnsaved`, `scheduleSave`, or `persistDocument`.
- Treating phase navigation as commit.

### `app/src/lib/components/collation/CollationWorkspace.svelte`

Planned changes:

- Load collation version status for `collationState.collationId`.
- Display committed-version state next to `AutoSaveIndicator`.
- Add commit dialog/control.
- On confirm, call `collationState.flushPendingSave()` and then `createCommittedCollationCheckpoint`.
- Refresh version status after commit.

Avoid:

- Changing phase content layout unnecessarily.
- Blocking normal autosave while the commit dialog is merely open.

### `app/src/lib/components/collation/AutoSaveIndicator.svelte`

Planned changes:

- Keep focused on autosave state.
- Optionally rename labels from `Saved`, `Saving`, `Unsaved`, `Error` to clearer local-save labels if product wording changes.

Avoid:

- Mixing checkpoint state into this component unless it is renamed and intentionally broadened.

### `app/src/routes/collation/[id]/[phase]/+page.svelte`

Expected changes:

- Probably none beyond whatever `CollationWorkspace` needs.

### `app/src/routes/collation/[id]/+layout.svelte`

Expected changes:

- Probably none.
- If status loading belongs at the layout level, ensure route phase redirects still work and do not depend on status load.

## State Machine

### Autosave State

For transcription:

- `dirty in editor memory`: route shows `Unsaved changes`.
- `saving`: current code does not expose a distinct parent state; first implementation may keep existing binary state.
- `saved`: route shows relative saved time.
- `error`: currently only logged by editor; consider exposing later if needed.

For collation:

- `saved`
- `saving`
- `unsaved`
- `error`

### Version State

For both entity types:

- `not-applicable`: library transcription or missing project context.
- `never-committed`: no current checkpoint head.
- `dirty`: working state differs from current checkpoint.
- `clean`: working state matches current checkpoint.
- `committing`: checkpoint creation in progress.
- `commit-error`: most recent commit attempt failed.

### Button Enablement

Enable `Commit version` when:

- Entity is applicable.
- Entity has an ID required by checkpoint API.
- No commit is in flight.
- Autosave is not currently saving, or commit handler can flush/wait.
- Version state is `never-committed` or `dirty`.

Disable `Commit version` when:

- Entity is library/global and not project-owned.
- Entity is clean to checkpoint.
- The editor/state is still loading.
- A commit is in flight.
- The last local save failed and cannot be flushed.

## Commit Flow Details

### Transcription Commit Flow

1. User clicks `Commit version`.
2. UI opens optional message dialog.
3. User confirms.
4. UI sets `commitInFlight = true` and clears previous error.
5. Route calls `await transcriptionEditor.flushPendingAutosave()`.
6. If flush fails, route shows local save error and stops.
7. Route confirms `projectTranscriptionId` is still available.
8. Route calls `createCommittedTranscriptionCheckpoint({ projectTranscriptionId, commitMessage })`.
9. Worker creates checkpoint and posts `transcriptions` invalidation.
10. Route reloads transcription and version status.
11. UI shows `Committed locally` and current checkpoint summary.

### Collation Commit Flow

1. User clicks `Commit version`.
2. UI opens optional message dialog.
3. User confirms.
4. UI sets `commitInFlight = true` and clears previous error.
5. Component calls `await collationState.flushPendingSave()`.
6. If flush fails, component shows local save error and stops.
7. Component confirms `collationState.collationId` is present.
8. Component calls `createCommittedCollationCheckpoint({ collationId, commitMessage })`.
9. Worker creates checkpoint and posts `collations` invalidation.
10. Component reloads collation version status.
11. UI shows `Committed locally` and current checkpoint summary.

## Interaction With Cloud Sync

Existing sync code already distinguishes committed and dirty local state:

- `publishEntity` returns `uncommitted local changes` or `saved locally` if no committed head exists.
- `deriveLocalSyncUiState` returns `saved locally`, `uncommitted local changes`, `committed locally`, `sync pending`, or `synced` based on dirty/head/metadata state.
- `serializeProjectTranscriptionCloudFile` and `serializeCollationCloudFile` reject uncommitted working state.

Subplan 2 should align UI with these rules:

- Commit action updates local committed head only.
- Backup action remains separate.
- Dirty-to-checkpoint state should be visible before backup failure.
- Existing sync status badges should not imply autosaved dirty state is backed up.

## Testing Plan

### Repository Tests

Existing tests in `revisions.spec.ts` already cover core checkpoint creation and dirty tracking. Extend them only if the implementation adds status-returning helpers or modifies persistence behavior.

Target file:

- `app/src/lib/client/db/repositories/revisions.spec.ts`

Cases:

- Committing a project transcription after autosaved content updates current head.
- Committing a collation after persisted projection/artifact updates current head.
- Blank commit message is stored as `null` if the UI/service normalizes it.
- Parent checkpoint ID remains correct after a second commit.
- Dirty status becomes false immediately after commit.

### Client/RPC Tests

If there are worker/RPC tests, add smoke coverage for:

- `revisions.commitTranscription`
- `revisions.commitCollation`
- New status read RPC requests if added by this subplan.

If worker tests are not practical, rely on repository tests plus `bun run check` for request/response type coverage.

### Transcription UI Manual Tests

Manual flow:

1. Create or open a project transcription.
2. Confirm the page shows autosave state separately from version state.
3. Edit text and wait for autosave.
4. Confirm autosave says saved but version state says changes since commit.
5. Commit with a message.
6. Confirm version state says committed.
7. Edit again and confirm version state returns to changes since commit.
8. Open a library/global transcription and confirm project commit UI is hidden or disabled with explanation.

Race-condition flow:

1. Edit text.
2. Immediately click commit before debounce fires.
3. Confirm the commit includes the latest editor content.
4. Confirm no stale checkpoint is created.

### Collation UI Manual Tests

Manual flow:

1. Create or open a collation.
2. Confirm autosave indicator and version status are both visible.
3. Make a setup/alignment/readings change.
4. Confirm autosave eventually returns to saved.
5. Confirm version status still says changes since commit.
6. Commit with a message.
7. Confirm version status says committed.
8. Make another collation change and confirm version status becomes dirty again.

Race-condition flow:

1. Make a collation change.
2. Immediately click commit before the 800ms save delay finishes.
3. Confirm `flushPendingSave` persists the latest working state before checkpoint creation.
4. Confirm the checkpoint payload includes the latest document/projection state.

### Backup Guard Manual Tests

Manual flow:

1. Create uncommitted project transcription changes.
2. Attempt any available backup/upload action.
3. Confirm UI blocks or warns with commit-first language.
4. Commit locally.
5. Confirm backup action becomes eligible or moves to pending-backup state.

Repeat for collation.

## Verification Commands

Run from `app/` after implementation:

```sh
bun run check
bun run db:check
```

Run targeted tests:

```sh
bun run test:unit -- --run src/lib/client/db/repositories/revisions.spec.ts
bun run test:unit -- --run src/lib/client/db/repositories/collations.spec.ts
bun run test:unit -- --run src/lib/client/db/repositories/projects.spec.ts
```

For edited Svelte files, run Svelte validation/autofixer on each changed `.svelte` or `.svelte.ts` file before finalizing.

Likely edited Svelte files:

- `app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte`
- `app/src/routes/transcription/[id]/+page.svelte`
- `app/src/lib/client/collation/collation-state.svelte.ts`
- `app/src/lib/components/collation/CollationWorkspace.svelte`
- Any new commit-control component

## Acceptance Criteria

- Project transcriptions have visible local commit UX.
- Collations have visible local commit UX.
- Autosave state and committed-version state are presented as different concepts.
- Commit actions accept optional messages.
- Commit actions flush pending autosave before creating checkpoints.
- Commit actions do not upload to cloud storage.
- Commit actions use `project_transcriptions.id` for project transcriptions, not `transcriptions.id`.
- Library/global transcriptions do not accidentally get project commit UI.
- Clean entities cannot create duplicate checkpoints through the default UI.
- Dirty entities become clean-to-checkpoint after successful commit.
- Backup actions, if present, are blocked or warned when local working state is uncommitted.
- Existing autosave behavior continues to work.
- Existing checkpoint tests continue to pass.
- `bun run check` and `bun run db:check` pass from `app/`.

## Risks and Mitigations

### Risk: Commit Captures Stale Data

If a user commits before a debounced autosave fires, the checkpoint could capture the previous database state.

Mitigation:

- Expose and call explicit flush methods before checkpoint creation.
- Ensure flush waits for in-flight saves.
- Add manual race-condition testing.

### Risk: Transcription Route Lacks Project Link ID

The route currently receives `transcriptions.id`, while checkpoint creation needs `project_transcriptions.id`.

Mitigation:

- Use Subplan 1 status APIs to resolve project context by project-owned transcription row ID.
- Hide or disable commit UI when no project-owned context exists.
- Never pass project-owned transcription row IDs to `createCommittedTranscriptionCheckpoint`; use `project_transcriptions.id`.

### Risk: UI Confuses Autosave With Commit

Users may assume `Saved` means backup-ready.

Mitigation:

- Use distinct labels: local save versus committed version.
- Keep indicators visually adjacent but semantically separate.
- Use commit-first language for backup blocking.

### Risk: Existing Collation Auto-Refresh Creates Surprise Dirty State

The current load path can refresh witness sources automatically and mark a collation unsaved.

Mitigation:

- Do not build commit UX around implicit witness refresh.
- Prefer disabling or gating `refreshChangedWitnessSourcesAfterLoad` before treating commits as intentional user versions.
- Move witness refresh into Subplan 4 as an explicit operation.

### Risk: Commit Button Encourages Excessive Checkpoints

Users could create redundant versions if the button is always enabled.

Mitigation:

- Disable by default when clean-to-checkpoint.
- Later history UI can add an advanced force-checkpoint option if needed.

### Risk: Collation Persistence Errors Are Currently Swallowed

`persistDocument` logs errors and updates `saveStatus`, but commit flow needs a reliable success/failure result.

Mitigation:

- Return a boolean or throw from the flush path while preserving current scheduled-save behavior.
- Do not commit after a failed flush.

## Dependencies for Later Subplans

Subplan 3 depends on:

- Project transcriptions having committed heads before source refresh decisions.
- Users understanding that project transcriptions do not auto-refresh from library sources.

Subplan 4 depends on:

- Collations having committed heads before and after witness refresh.
- Users understanding that witness refresh dirties the collation until it is committed.

Subplan 5 depends on:

- Dirty-to-checkpoint UI making it clear why backup is blocked.
- Commit actions producing upload-eligible project transcription and collation primaries/history.

Subplan 8 depends on:

- Clear separation between autosaved local state, committed local versions, and backed-up versions.

## Open Questions

No blocking questions are required to implement this subplan.

Questions to revisit during implementation:

- Should the first commit message default to `Initial version`, or should blank remain `null`?
- Should commit dialogs be inline popovers or modal dialogs?
- Should transcription autosave expose a distinct `saving` state to the parent route, or is the existing binary unsaved/saved indicator enough for the first pass?
- Should `refreshChangedWitnessSourcesAfterLoad` be removed in this subplan or deferred to Subplan 4 cleanup?

## Implementation Decisions

### Collation Commit Slice (landed)

- Added `collationState.flushPendingSave()` returning `Promise<boolean>`. It clears any pending debounce timeout, awaits an in-flight save (tracked via `inFlightSave`) instead of starting a concurrent save, persists when status is `unsaved` or retries on `error`, and returns `true` only when the latest working state is durably persisted.
- `persistDocument` now returns `Promise<boolean>` (success/failure) while preserving `scheduleSave` behavior through a shared `runPersist` helper that owns `saveStatus` transitions and in-flight deduplication.
- `CollationWorkspace.svelte` loads `CollationVersionStatus` for `collationState.collationId`, reloads on `collations` invalidations, shows committed-version state (`No committed version yet` / `Changes since commit` / `Committed` plus short revision id) next to `AutoSaveIndicator`, and provides a `Commit version` control with an optional message. The commit handler flushes pending save before `createCommittedCollationCheckpoint`, then reloads status. The commit button is disabled when clean or when status is still loading.
- Added `flushPendingSave` unit tests in `collation-state-load.spec.ts` covering no-pending, unsaved, in-flight, and failure paths.

### Witness Auto-Refresh on Load

Decision: `refreshChangedWitnessSourcesAfterLoad` is left in place for Subplan 2 and deferred to Subplan 4. Subplan 4 owns explicit witness refresh UI and is the right place to replace implicit load-time refresh with an explicit, pinned-witness model. The commit UX remains correct regardless: `flushPendingSave` flushes any pending save (including one scheduled by an implicit refresh) before checkpoint creation, so commits always capture the latest persisted working state.

## Recommended First Implementation Slice

Start with the smallest coherent user-visible workflow:

1. Add or confirm Subplan 1 status lookup for an open project transcription.
2. Expose `flushPendingAutosave` from `TranscriptionEditor.svelte`.
3. Add transcription commit UI to `/transcription/[id]` for project-owned transcriptions only.
4. Add tests or manual verification for immediate-click-after-edit commit correctness.

Then implement the collation side:

1. Add `collationState.flushPendingSave`.
2. Add collation version status display and commit UI in `CollationWorkspace.svelte`.
3. Decide whether to disable/gate current automatic witness refresh on load.
4. Verify dirty-to-clean checkpoint transitions for collations.
