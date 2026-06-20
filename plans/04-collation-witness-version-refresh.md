# Subplan 4: Collation Witness Version Refresh

## Selection Rationale

This subplan follows project transcription refresh because collation witnesses should be pinned to explicit project transcription versions. A project transcription may be refreshed or edited, but an existing collation should not silently adopt newer witness content. Users need an intentional refresh operation for one witness, multiple stale witnesses, or a selected source checkpoint.

## Goal

Let users intentionally update a collation to use newer committed transcription content.

After this subplan, users should be able to:

- See each collation witness with its pinned source revision and hash.
- See whether the linked project transcription has a newer committed checkpoint.
- Refresh one witness from a selected committed source checkpoint.
- Refresh all stale witnesses in one deliberate action.
- Understand that witness refresh dirties the collation until the collation is committed.
- Commit the refreshed collation before cloud backup.

## Non-Goals

- Do not refresh witnesses automatically on load.
- Do not refresh project transcriptions from library sources. That belongs to Subplan 3.
- Do not upload refreshed collations to cloud automatically. That belongs to Subplan 5.
- Do not change collation witness source semantics from pinned to live references.
- Do not infer refresh paths for legacy witnesses without reliable `project_transcription_id` unless a repair flow is added.

## Current Grounding

### Existing Witness Source Metadata

`app/src/lib/client/db/repositories/collations.ts` stores source metadata when saving projections:

- `collation_witnesses.project_transcription_id`
- `collation_witnesses.transcription_id`
- `collation_witnesses.source_revision_id`
- `collation_witnesses.source_content_hash`

`saveCollationProjection` calls `loadWitnessSourceMetadata`, which joins current project transcription rows to set witness source metadata.

`loadProjection` currently returns only:

- `witnessId`
- `transcriptionId`
- `sourceVersion`
- `content`
- `position`

It does not expose `projectTranscriptionId` or `sourceContentHash` to the public projection record.

### Existing Collation State Behavior

`app/src/lib/client/collation/collation-state.svelte.ts` stores witness configs in memory and persists the canonical collation document/artifacts through autosave.

Important current behavior:

- `loadCollationById` calls `refreshChangedWitnessSourcesAfterLoad(id)`.
- That can detect changed witness transcriptions, refresh witness text, mark `saveStatus = 'unsaved'`, and schedule save.

This behavior conflicts with the intended pinned witness model. It should be removed, gated, or converted into an explicit prompt before this subplan is considered complete.

### Existing Serialization Constraints

`app/src/lib/client/sync/cloud-files.ts` has `assertCollationSourcesSyncReady`, which rejects collations whose witnesses are missing committed source revision metadata.

This is a useful invariant:

- Cloud-ready collations must have committed, pinned witness source metadata.
- Refreshed collations must be committed before upload.

## Product Semantics

### Pinned Witness Source

A collation witness uses the transcription content recorded at a specific source revision/hash.

Rules:

- The witness content and pinned metadata are part of collation state.
- Updating the project transcription does not change the witness.
- Refreshing the witness is a collation edit.
- A refreshed witness makes the collation dirty-to-checkpoint.

### Stale Witness

A witness is stale when:

- It is linked to a project transcription.
- The project transcription has a committed head.
- That committed head differs from the witness's pinned `source_revision_id` or `source_content_hash`.

A witness is not automatically stale merely because the source has uncommitted edits. In that case, status should be `source has uncommitted changes`.

### Refresh

Refresh means replacing a witness's source text and pinned metadata with content from a selected committed project transcription checkpoint.

Rules:

- Refresh changes collation working state.
- Refresh should update witness source metadata in both the canonical collation document state and normalized projection rows.
- Refresh should recalculate regularization/alignment/readings as needed.
- Refresh should not create a collation checkpoint automatically unless the user explicitly commits.

## UX Requirements

### Witness Status Display

Show witness version status in collation setup and workspace surfaces.

For each witness, display:

- Witness siglum/label.
- Linked project transcription.
- Pinned checkpoint ID/hash summary.
- Available committed checkpoint ID/hash summary.
- Status: current, newer version available, source has uncommitted changes, source missing, no committed source, legacy/incomplete metadata.

Recommended compact labels:

- `Pinned current`
- `Newer source version`
- `Source has uncommitted edits`
- `No committed source version`
- `Source missing`
- `Legacy witness metadata`

### Refresh Actions

Provide actions at two levels:

- Per witness: `Refresh witness`
- Bulk: `Refresh stale witnesses`

Per-witness dialog should show:

- Current pinned checkpoint.
- Available source checkpoint.
- Text preview or summary of changed source if cheap to compute.
- Warning that alignment/readings may need review.

Bulk action should show:

- Count of stale witnesses.
- List of witnesses to refresh.
- Warning that the collation will have uncommitted changes.

### Commit Requirement

After witness refresh:

- Autosave should persist refreshed working state locally.
- Collation committed-version state should show changes since commit.
- Cloud backup should be blocked until user commits the collation.

## Repository Plan

### `app/src/lib/client/db/repositories/collations.ts`

Add read and command APIs for witness refresh.

Recommended status read APIs from Subplan 1:

- `getCollationVersionStatus(db, collationId)`
- `getCollationWitnessSourceStatuses(db, collationId)`

Recommended command APIs:

```ts
export interface RefreshCollationWitnessInput {
	collationId: string;
	witnessId: string;
	sourceCheckpointId?: string;
	updatedAt?: string;
}

export async function refreshCollationWitnessSource(
	db: Kysely<Database>,
	input: RefreshCollationWitnessInput,
): Promise<CollationWitnessSourceStatus>;
```

```ts
export interface RefreshStaleCollationWitnessesInput {
	collationId: string;
	witnessIds?: string[];
	updatedAt?: string;
}

export async function refreshStaleCollationWitnesses(
	db: Kysely<Database>,
	input: RefreshStaleCollationWitnessesInput,
): Promise<CollationWitnessSourceStatus[]>;
```

Implementation rules:

- Resolve witness by `collationId` and `witnessId`.
- Require `project_transcription_id` for safe refresh.
- Load the linked project transcription committed checkpoint.
- If `sourceCheckpointId` is supplied, load that checkpoint; otherwise use current committed head.
- Validate checkpoint hash.
- Extract witness text from the checkpoint payload.
- Update `collation_witnesses.content`, `source_revision_id`, `source_content_hash`, and `transcription_id` if needed.
- Rebuild dependent `collation_tokens`, `collation_variation_units`, readings, and artifacts only through the same projection/document path used by collation state, or return data for the UI state to rebuild.

Important design choice:

- Prefer doing content transformation in `collation-state.svelte.ts` where witness tokenization, regularization, and alignment rebuild logic already exists.
- Repository commands should update persisted rows only after the collation state has produced a coherent refreshed document/projection.

### `app/src/lib/client/db/repositories/revisions.ts`

Add helper APIs if needed:

- `loadCommittedTranscriptionCheckpointPayload`
- `listCommittedTranscriptionCheckpoints`

These should validate hash integrity and return parsed payloads.

### `app/src/lib/client/collation/collation-state.svelte.ts`

Add explicit witness refresh methods and remove implicit refresh-on-load.

Recommended public methods:

- `loadWitnessVersionStatuses()`
- `refreshWitnessSource(witnessId, checkpointId?)`
- `refreshAllStaleWitnessSources()`

Implementation behavior:

- Load source checkpoint content.
- Build a new `WitnessConfig` for refreshed source content.
- Apply existing treatment/excluded-hand settings.
- Re-run regularization.
- Rebuild alignment if alignment already exists.
- Clear or reset classified readings/stemma data when source text changes.
- Mark autosave `unsaved` and schedule save.
- Do not commit automatically.

Important cleanup:

- Replace `refreshChangedWitnessSourcesAfterLoad` with status detection plus optional notification.
- If a source changed after load, show `Newer witness source available` rather than changing the collation.

### `app/src/lib/client/collation/collation-runner.ts`

Review how sourceVersion is set during collation creation.

Current references set `sourceVersion` from `transcription.current_revision_id`.

Requirements:

- Ensure new witnesses created from project transcriptions have a committed source revision/hash.
- If source project transcription has no committed checkpoint, block witness creation or prompt commit first.
- Do not use timestamps or working row versions as source versions.

### RPC and Client Wrappers

Add typed read/command entries to:

- `app/src/lib/client/db/rpc.ts`
- `app/src/lib/client/db/client.ts`
- `app/src/lib/client/db/db.worker.ts`

Mutation handlers should invalidate `collations`.

## UI Plan

### `app/src/lib/components/collation/SetupPhase.svelte`

Add witness source status where witnesses are selected and configured.

Recommended display:

- Status badge per selected witness.
- `Refresh` action for stale witness.
- `Commit source first` hint for source with uncommitted edits.

### `app/src/lib/components/collation/CollationWorkspace.svelte`

Add high-level witness version summary near autosave/commit status.

Example summary:

- `All witness sources current`
- `2 witness sources have newer committed versions`
- `1 witness source has uncommitted edits`

Add bulk action:

- `Refresh stale witnesses`

### `app/src/lib/components/collation/AutoSaveIndicator.svelte`

Keep this focused on autosave. Do not overload it with witness version status.

Add a separate witness status component if needed:

- `WitnessVersionStatus.svelte`
- `WitnessRefreshDialog.svelte`

## Refresh Algorithm

### Single Witness Refresh

1. User selects `Refresh witness`.
2. UI loads available source checkpoint status.
3. UI asks for confirmation.
4. State layer loads committed source content for selected checkpoint.
5. State layer rebuilds the witness config.
6. State layer applies regularization and alignment invalidation rules.
7. State layer saves refreshed document/projection through autosave or explicit flush.
8. Version status marks collation dirty-to-checkpoint.
9. User commits collation through Subplan 2 UX.

### Bulk Stale Witness Refresh

1. UI identifies stale witnesses from status read model.
2. User confirms `Refresh stale witnesses`.
3. State layer refreshes each stale witness from its current committed source head.
4. State layer rebuilds derived collation structures once after all witnesses are updated.
5. Autosave persists refreshed state.
6. UI shows `Commit collation before backup`.

## Derived Data Rules

### Alignment Impact

If refreshed witness text changes token count or token order:

- Existing alignment may be invalid.
- Rebuild alignment from witness tokens if safe.
- Clear readings and stemma state if alignment changes.

If refreshed witness text is identical but checkpoint metadata changed:

- Update pinned revision/hash.
- Mark collation dirty-to-checkpoint because metadata changed.
- Alignment/readings can remain intact.

### Readings and Stemma Impact

If alignment changes:

- Clear classified readings.
- Clear stemma edges/nodes.
- Reset selected unit index.
- Move phase back to alignment if current phase is stemma.

These rules match existing `handleWitnessSourceChange` behavior.

## Testing Plan

### Repository Tests

Target files:

- `app/src/lib/client/db/repositories/collations.spec.ts`
- `app/src/lib/client/db/repositories/revisions.spec.ts`

Cases:

- Witness status reports `pinned-current` when source head matches pinned metadata.
- Witness status reports `newer-source-available` when source head differs.
- Witness status reports `source-has-uncommitted-changes` when source working hash differs from source head.
- Witness status reports legacy/incomplete when `project_transcription_id` is missing.
- Refresh updates witness content and source metadata.
- Refresh does not update collation `current_revision_id`.
- Refresh makes collation dirty-to-checkpoint.

### State/UI Manual Tests

Manual flow:

1. Create project transcriptions and commit them.
2. Create a collation from those witnesses and commit it.
3. Edit and commit one project transcription.
4. Open the collation.
5. Confirm witness status shows newer source available but witness content does not change automatically.
6. Refresh one witness.
7. Confirm collation becomes dirty.
8. Commit collation.
9. Confirm cloud serialization is now eligible.

Regression flow:

1. Open an older collation whose sources changed.
2. Confirm `refreshChangedWitnessSourcesAfterLoad` no longer silently mutates it.

## Verification Commands

Run from `app/`:

```sh
bun run check
bun run db:check
bun run test:unit -- --run src/lib/client/db/repositories/collations.spec.ts
bun run test:unit -- --run src/lib/client/db/repositories/revisions.spec.ts
```

Run Svelte validation/autofixer for edited `.svelte` and `.svelte.ts` files.

## Acceptance Criteria

- Collation witnesses remain pinned until the user refreshes them.
- UI shows pinned and available source versions for witnesses.
- Users can refresh one stale witness.
- Users can refresh all stale witnesses.
- Refresh makes the collation dirty-to-checkpoint.
- Cloud backup remains blocked until refreshed collation is committed.
- Legacy/incomplete witness metadata is visible and non-crashing.
- Automatic witness source refresh on load is removed or gated behind explicit user confirmation.

## Risks and Mitigations

### Risk: Refresh Invalidates Scholarly Work Silently

Mitigation:

- Require explicit confirmation.
- Warn when readings/stemma will be reset.
- Do not auto-commit after refresh.

### Risk: Legacy Witnesses Cannot Refresh

Mitigation:

- Show `Legacy witness metadata`.
- Add a later repair flow if necessary.
- Do not guess a source based only on siglum.

### Risk: State and Repository Fall Out of Sync

Mitigation:

- Use one refresh pathway through collation state for document/projection coherence.
- Repository tests should validate persisted rows after state-level refresh saves.

## Open Questions

- Should users be able to choose an older source checkpoint on the first implementation, or only latest committed source head?
- Should text diffs be shown in refresh dialogs?
- Should witness refresh create a draft checkpoint automatically before replacing alignment/readings? The preferred answer is no unless users need recovery beyond undo.

## Recommended First Implementation Slice

1. Remove or gate automatic witness refresh on load.
2. Add witness version status display.
3. Add single-witness refresh from latest committed source head.
4. Verify refreshed collation becomes dirty and requires commit.

Then add bulk refresh and checkpoint chooser.

## Implementation Progress

### Completed

- **Automatic refresh on load removed**: `refreshChangedWitnessSourcesAfterLoad` and `findChangedWitnessTranscriptionIds` deleted from `collation-state.svelte.ts`; `getTranscriptionVersionsByIds` import removed; `loadCollationById` no longer mutates witnesses on load. Test updated to verify no automatic refresh.
- **Committed checkpoint payload RPC added**: `revisions.loadCommittedTranscriptionCheckpointPayload` wired through `rpc.ts`, `client.ts`, and `db.worker.ts`.
- **`prepareWitnessesFromDocument` extracted**: `collation-runner.ts` refactored to export a reusable helper for preparing witnesses from a specific document (checkpoint content) rather than from the transcriptions table.
- **`collationState.refreshWitnessSource` added**: Loads a committed checkpoint payload, coerces content into a document, re-extracts witness tokens via `prepareWitnessesFromDocument`, matches by kind/handId, updates witness config, calls `handleWitnessSourceChange()` to rebuild alignment and clear readings/stemma, and marks dirty-to-commit via `markUnsaved()`. Accepts optional `sourceCheckpointId` and falls back to `availableCheckpoint.revisionId` from version status.
- **Witness version status UI added**: `CollationWorkspace.svelte` shows a witness source summary and passes statuses to `SetupPhase.svelte`; `SetupPhase.svelte` adds a "Source Version" column with per-witness status badges and a "Refresh" button with a confirmation dialog.
- **Tests**: `collation-state-load.spec.ts` updated and new `refreshWitnessSource` test added. 147 tests pass across 20 files. `bun run check` (0 errors, 1 pre-existing warning) and `bun run db:check` pass.
- **Bulk refresh added**: `collationState.refreshAllStaleWitnessSources()` refreshes stale witnesses from their current committed source heads and rebuilds derived collation state once; `CollationWorkspace.svelte` adds a guarded `Refresh stale witnesses` action and flushes autosave before reloading version status.
- **Checkpoint chooser added**: `SetupPhase.svelte` loads committed source checkpoints for a witness and lets users refresh from an older committed checkpoint as well as the latest head. Witness configs, canonical collation documents, and normalized projection rows now preserve `sourceContentHash` so older checkpoint selections remain pinned after save.
- **Verification**: `bun run check` passed with the pre-existing triiiceratops a11y warning; `bun run db:check` passed; targeted `collations`, `revisions`, and `collation-state-load` tests passed with added coverage for bulk refresh, explicit checkpoint hash preservation, and canonical artifact persistence.

### Remaining

- Cloud backup guard that blocks upload when witnesses are stale or collation is dirty-to-checkpoint (deferred to Subplan 05).
