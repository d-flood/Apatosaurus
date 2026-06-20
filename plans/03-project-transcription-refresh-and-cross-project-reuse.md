# Subplan 3: Project Transcription Refresh and Cross-Project Reuse

## Selection Rationale

This subplan should follow the domain/status APIs and local commit UX because project transcription refresh is only safe when the app can identify project transcriptions by stable `project_transcriptions.id` and can distinguish autosaved working edits from committed source versions.

The core product decision is that project transcriptions are full transcription data owned by a project. Library transcriptions and other project transcriptions can be used as source material, but no edit should silently update another project. This plan turns that decision into explicit repository commands and UI flows.

## Goal

Provide explicit UI for updating project transcriptions from committed source versions and for intentionally reusing corrected project transcriptions across projects.

After this subplan, users should be able to:

- See every project transcription linked to a project.
- Understand where each project transcription came from.
- See whether its source has a newer committed version.
- Refresh a selected project transcription from a selected committed source checkpoint.
- Preserve the stable `project_transcriptions.id` during refresh.
- Promote a corrected project transcription into reusable library source material.
- Add a committed transcription from another local project into the current project by explicit choice.

## Non-Goals

- Do not auto-refresh project transcriptions when a library source changes.
- Do not auto-refresh other projects when one project transcription changes.
- Do not refresh collation witnesses. That belongs to Subplan 4.
- Do not upload refreshed project transcriptions to cloud automatically. That belongs to Subplan 5.
- Do not introduce shared cloud transcription references.
- Do not make project transcriptions point directly at library rows.
- Do not make library edits commit automatically unless a separate library commit decision has been made.

## Terminology Note

The current schema and some existing functions still use names such as `scope_type = 'project_snapshot'`, `snapshotTranscriptionId`, and `addProjectTranscriptionSnapshot`. In this plan those are internal legacy labels for project-owned transcription rows. They are not historical versions and they are not lightweight references to partial transcription data. Historical versions are checkpoints in `transcription_checkpoints` and history files under `history/transcriptions/...`.

New APIs and UI should use `projectTranscriptionId` for `project_transcriptions.id` and `projectOwnedTranscriptionId` for the underlying `transcriptions.id` row.

## Current Grounding

### Existing Project Membership Flow

`app/src/routes/projects/+page.svelte` currently owns the project management UI. It loads:

- Project list through `listProjects`.
- Project metadata through `getProject`.
- Linked project transcription row IDs through `getProjectTranscriptionIds`.
- A combined transcription catalog through `listTranscriptions(projectId)`.
- Project transcription membership changes through `syncProjectTranscriptionIds(projectId, nextIds)`.

`app/src/lib/components/projects/ProjectTranscriptionsEditor.svelte` currently renders selectable transcription options and per-hand treatment controls. It receives `selectedTranscriptionIds`, and those IDs are currently `transcriptions.id` row values rather than stable `project_transcriptions.id` values.

### Existing Repository Behavior

`app/src/lib/client/db/repositories/projects.ts` already contains the important project-owned transcription creation behavior:

- `syncProjectTranscriptionIds` accepts a list of transcription IDs.
- Existing project links are matched by current project-owned transcription row ID or source ID.
- New source IDs are cloned by the existing internally named `addProjectTranscriptionSnapshot` helper.
- The clone is inserted into `transcriptions` with the current internal `scope_type = 'project_snapshot'` and `project_id` set.
- The project link is inserted into `project_transcriptions`.
- `origin_type`, `origin_project_id`, `origin_transcription_id`, `origin_revision_id`, and `origin_content_hash` record provenance when the source has a committed head.
- IIIF rows and verse index rows are copied from the source transcription into the project-owned transcription.

The current behavior supports initial project transcription creation, but it does not provide a refresh command that updates an existing project transcription while preserving `project_transcriptions.id`.

### Existing Status Dependencies

Subplan 1 should provide read models that expose:

- `projectTranscriptionId`
- `projectOwnedTranscriptionId`
- source provenance
- source committed head
- source dirty state
- current project transcription committed head
- project transcription dirty-to-checkpoint state

Subplan 2 should provide commit UI for project transcriptions and collations.

These status models are required before this subplan can show accurate refresh availability.

## Product Semantics

### Refresh

Refresh means replacing a project's transcription working content and metadata with content from a selected committed source checkpoint.

Rules:

- Refresh is explicit.
- Refresh preserves `project_transcriptions.id`.
- Refresh keeps cloud path identity stable: `transcriptions/{projectTranscriptionId}.json`.
- Refresh updates the editable project-owned transcription row and copied child rows.
- Refresh records the source checkpoint ID and content hash on the project-owned transcription's origin fields.
- Refresh creates uncommitted working state unless the user explicitly commits afterward.
- Refresh should not update collations automatically.

### Promote To Library

Promote means copying a committed project transcription into the reusable local library as a new library transcription, or as a new committed version of an existing library transcription if that workflow is later chosen.

First implementation recommendation:

- Promote creates a new library transcription row.
- The new row is `scope_type = 'global'` and `project_id = null`.
- Its origin points back to the source project transcription.
- It does not mutate any existing library transcription.

Reasoning:

- Creating a new library row is safer than overwriting source material that other projects may use.
- A later advanced flow can support updating an existing library source with explicit conflict checks.

### Add From Another Project

Add from another project means using a committed transcription from another local project as source material for a new project transcription in the current project.

Rules:

- This is explicit cross-project reuse.
- The receiving project gets its own full project transcription.
- The source project remains unchanged.
- The receiving project transcription records origin metadata pointing to the source project, source transcription, and source checkpoint.

## UX Requirements

### Project Page Status List

On the Projects page, show each linked project transcription with:

- Display label and title.
- Stable project transcription ID in developer/debug detail if useful.
- Project-owned transcription row ID in developer/debug detail if useful.
- Source type: library, other project, promoted library source, unknown.
- Source title/siglum where available.
- Current status: never committed, committed, changes since commit.
- Source status: up to date, newer committed source available, source has uncommitted edits, source missing, no committed source version.
- Collation impact hint: existing collation witnesses stay pinned until refreshed.

### Refresh Action

For a project transcription, provide a `Refresh from source` action when a valid committed source version is available.

The action should:

- Be disabled when the source has no committed version.
- Warn when the source has uncommitted edits and prompt the user to commit the source first.
- Warn when the project transcription has uncommitted local changes and require confirmation before replacing working state.
- Let the user pick the latest source checkpoint at first.
- Later support choosing a specific older source checkpoint from history.
- Tell the user that existing collation witnesses will not change until refreshed.

Suggested dialog text:

- Title: `Refresh project transcription from source`
- Summary: `This replaces the project transcription's working content with the selected committed source version.`
- Warning: `Collations that already use this transcription remain pinned to their current witness versions.`
- Confirmation checkbox if dirty: `Replace uncommitted changes in this project transcription.`
- Button: `Refresh transcription`

### Promote To Library Action

For a project transcription, provide a `Promote to library` action.

The action should:

- Require the project transcription to be committed or prompt the user to commit first.
- Let the user choose title, siglum, description, and optional note.
- Create a new library transcription row from the selected committed project transcription.
- Optionally link the current project transcription's `canonical_transcription_id` to the new library source only if the user chooses that.

First implementation recommendation:

- Do not relink the current project transcription automatically.
- Show the newly created library transcription in the project transcription picker/catalog.

### Add From Another Project Action

Add a flow for selecting a committed project transcription from another local project and adding it to the current project.

The flow should show:

- Source project name.
- Source transcription label/title.
- Source committed head.
- Dirty state of the source project transcription.
- Whether the current project already has a transcription from the same canonical source.

Rules:

- If the source project transcription has uncommitted edits, prompt the user to commit it first.
- If the current project already has a transcription with the same canonical source, ask whether to refresh existing or add an additional transcription.
- Preserve current project membership ordering where possible.

## Data Model Expectations

No schema change should be required for the first version.

Existing fields can represent provenance:

- `transcriptions.origin_type`
- `transcriptions.origin_project_id`
- `transcriptions.origin_transcription_id`
- `transcriptions.origin_revision_id`
- `transcriptions.origin_content_hash`
- `project_transcriptions.canonical_transcription_id`

Expected origin conventions:

- Library source added to project: `origin_type = 'canonical'` or existing source scope value.
- Project transcription added to another project: current schema may use `origin_type = 'project_snapshot'`; treat this as an internal legacy value until a migration renames it.
- Promoted project transcription copied into library: current schema may use `origin_type = 'project_snapshot'`, `project_id = null`, `scope_type = 'global'`; treat the value as legacy internal vocabulary.
- Refreshed project transcription: origin fields update to the selected source checkpoint.

Open naming detail:

- Use existing `origin_type` values where necessary for compatibility. Prefer UI labels derived from context rather than exposing legacy enum values.

## Repository Plan

### `app/src/lib/client/db/repositories/projects.ts`

Add project transcription refresh and source-reuse operations.

Recommended functions:

```ts
export interface RefreshProjectTranscriptionInput {
	projectTranscriptionId: string;
	sourceTranscriptionId: string;
	sourceCheckpointId: string;
	allowReplaceDirty?: boolean;
	updatedAt?: string;
}

export async function refreshProjectTranscription(
	db: Kysely<Database>,
	input: RefreshProjectTranscriptionInput,
): Promise<ProjectTranscriptionStatus>;
```

Recommended behavior:

- Load the target project link and project-owned transcription row.
- Verify the target row belongs to the target project.
- Verify the source checkpoint is committed.
- Verify source checkpoint belongs to the selected source transcription.
- Verify source checkpoint hash matches its payload.
- If target is dirty and `allowReplaceDirty` is false, throw a typed error or return a blocked result.
- Replace target metadata/content from the selected source payload.
- Replace copied verse index rows from the new source content.
- Replace IIIF rows from the source row if source row exists locally, or from checkpoint payload if it contains serialized child rows.
- Update target origin metadata to the selected source checkpoint.
- Update target `updated_at`.
- Do not update `current_revision_id` or `current_content_hash`; the refreshed working state must be committed by user action.

Important implementation detail:

- The checkpoint payload created by `buildTranscriptionHashPayload` must contain enough project transcription data to reconstruct the row and child rows. Use that payload when refreshing from a checkpoint so refresh can target a specific committed version, not merely the source row's current working state.

Additional functions:

```ts
export interface PromoteProjectTranscriptionToLibraryInput {
	projectTranscriptionId: string;
	sourceCheckpointId?: string;
	title?: string;
	siglum?: string;
	description?: string;
	createdAt?: string;
}

export async function promoteProjectTranscriptionToLibrary(
	db: Kysely<Database>,
	input: PromoteProjectTranscriptionToLibraryInput,
): Promise<string>;
```

```ts
export interface AddProjectTranscriptionFromProjectInput {
	targetProjectId: string;
	sourceProjectTranscriptionId: string;
	sourceCheckpointId?: string;
	createdAt?: string;
}

export async function addProjectTranscriptionFromProject(
	db: Kysely<Database>,
	input: AddProjectTranscriptionFromProjectInput,
): Promise<{ projectTranscriptionId: string; projectOwnedTranscriptionId: string }>;
```

### `app/src/lib/client/db/repositories/transcriptions.ts`

Add source candidate listing helpers if they do not fit cleanly in `projects.ts`.

Recommended functions:

- `listLibraryTranscriptionSourceCandidates`
- `listProjectTranscriptionSourceCandidates`
- `getTranscriptionCheckpointSummaries`

These should expose committed checkpoint summaries without loading full payloads until needed.

### `app/src/lib/client/db/repositories/revisions.ts`

Add checkpoint payload loaders if needed.

Recommended functions:

- `loadCommittedTranscriptionCheckpointPayload(transcriptionId, checkpointId)`
- `listCommittedTranscriptionCheckpoints(transcriptionId)`

Reasoning:

- Refresh should be able to choose a specific committed source checkpoint.
- The revisions repository owns checkpoint integrity and hash validation.

### `app/src/lib/client/collation/project-collation.ts`

Expose service wrappers for UI:

- `refreshProjectTranscription`
- `promoteProjectTranscriptionToLibrary`
- `addProjectTranscriptionFromProject`
- `listProjectTranscriptionStatuses`
- `listProjectTranscriptionSourceCandidates`

### `app/src/lib/client/db/rpc.ts`, `client.ts`, and `db.worker.ts`

Add typed RPC entries and client wrappers for the new commands and source-candidate reads.

Mutation RPC handlers should post invalidation events for:

- `projects`
- `transcriptions`
- Possibly `collations` only if a command explicitly updates collation rows, which this subplan should not do.

## UI Plan

### `app/src/routes/projects/+page.svelte`

Planned changes:

- Load project transcription status rows from Subplan 1, not only `transcriptions.id` row IDs.
- Pass status rows into the project transcription editor or a new status component.
- Add handlers for refresh, promote, and add-from-project flows.
- Reload project transcription statuses after each operation.
- Keep existing membership toggle behavior working.

### `app/src/lib/components/projects/ProjectTranscriptionsEditor.svelte`

Potential approaches:

- Add status display and actions to this component.
- Or keep the current membership picker simple and add a separate `ProjectTranscriptionVersionsPanel.svelte` below it.

Recommendation:

- Add a separate status/action panel for the first implementation.

Reasoning:

- The existing component is already responsible for membership and collation treatment controls.
- Refresh/reuse flows have a different mental model and require more explanation.

Potential new component:

- `app/src/lib/components/projects/ProjectTranscriptionVersionsPanel.svelte`

Props:

- `projectId`
- `statuses`
- `isLoading`
- `onRefreshTranscription`
- `onPromoteTranscription`
- `onAddFromProject`

### Source Picker Dialogs

Add small focused dialogs rather than expanding the page with all controls at once.

Potential components:

- `ProjectTranscriptionRefreshDialog.svelte`
- `PromoteProjectTranscriptionDialog.svelte`
- `AddProjectTranscriptionFromProjectDialog.svelte`

Keep them data-driven and avoid direct DB calls inside the dialogs unless the route passes service functions.

## Refresh Algorithm

### Refresh Latest Committed Source

1. User selects `Refresh from source` for a project transcription.
2. UI loads the source committed checkpoint summary.
3. If source has no committed checkpoint, block and prompt commit first.
4. If source has uncommitted edits, show `Commit source first to include the latest edits.`
5. UI checks whether target project transcription is dirty-to-checkpoint.
6. If target is dirty, require explicit confirmation to replace local working edits.
7. Repository validates target link, source row, and source checkpoint.
8. Repository replaces target data and child rows from the selected checkpoint payload.
9. Repository updates target origin metadata to the selected checkpoint.
10. Repository leaves target committed head stale so status becomes `dirty`.
11. UI shows `Project transcription refreshed. Commit this project transcription before backup.`

### Optional Commit After Refresh

Do not auto-commit in the first implementation.

Offer a follow-up button:

- `Commit refreshed transcription`

Reasoning:

- Refresh changes should remain inspectable before they become a committed local version.
- This keeps the autosave/commit invariant consistent with Subplan 2.

## Cross-Project Reuse Algorithm

### Add From Another Project

1. User chooses `Add from another project`.
2. UI lists source project transcriptions with committed status.
3. User selects a source committed checkpoint.
4. Repository creates a new full project transcription in the target project from checkpoint payload.
5. Repository inserts a new `project_transcriptions` row.
6. Repository records origin metadata pointing to the source project transcription/checkpoint.
7. UI reloads target project transcription statuses.
8. User can commit the new project transcription if needed.

### Promote To Library

1. User chooses `Promote to library` on a project transcription.
2. UI requires a committed source checkpoint or prompts commit first.
3. User confirms title/siglum/description.
4. Repository creates a new library `transcriptions` row from checkpoint payload.
5. Repository copies verse index and IIIF rows.
6. UI reloads library transcription catalog.
7. The promoted source can be selected by other projects.

## Testing Plan

### Repository Tests

Target files:

- `app/src/lib/client/db/repositories/projects.spec.ts`
- `app/src/lib/client/db/repositories/revisions.spec.ts`

Cases:

- Refresh preserves `project_transcriptions.id`.
- Refresh preserves `project_id` and target project-owned transcription row identity.
- Refresh updates target content from the selected source checkpoint payload.
- Refresh updates origin revision/hash to the selected checkpoint.
- Refresh does not update collation witnesses.
- Refresh blocks when target is dirty and replace confirmation is absent.
- Refresh blocks when source checkpoint is missing or uncommitted.
- Add from another project creates a distinct project-owned transcription and link in the target project.
- Promote to library creates a `scope_type = 'global'`, `project_id = null` row.
- Existing `syncProjectTranscriptionIds` behavior continues to work.

### UI Manual Tests

Manual flow:

1. Create a library transcription and commit it if library commit support exists.
2. Add it to Project A and Project B.
3. Edit/commit the source or a source project transcription.
4. Confirm Project A and Project B do not change automatically.
5. Refresh only Project A.
6. Confirm Project B remains unchanged.
7. Confirm Project A's existing collation witnesses remain pinned.
8. Promote Project A's corrected transcription to the library.
9. Add the promoted source to Project B by explicit choice.

## Verification Commands

Run from `app/`:

```sh
bun run check
bun run db:check
bun run test:unit -- --run src/lib/client/db/repositories/projects.spec.ts
bun run test:unit -- --run src/lib/client/db/repositories/revisions.spec.ts
```

Run Svelte validation/autofixer for any changed `.svelte` or `.svelte.ts` files.

## Acceptance Criteria

- Projects page shows project transcription provenance and source freshness.
- Users can refresh a project transcription from a committed source checkpoint.
- Refresh preserves stable `project_transcriptions.id`.
- Refresh does not alter other projects.
- Refresh does not alter collation witnesses.
- Users can explicitly promote a project transcription into the library.
- Users can explicitly add a committed transcription from another local project.
- Dirty or uncommitted source/target states are blocked or warned clearly.
- Existing membership picker behavior remains intact.
- User-facing UI uses “Project transcription” terminology for project-owned transcription data.

## Risks and Mitigations

### Risk: Refresh Accidentally Uses Source Working State

Mitigation:

- Refresh from committed checkpoint payloads, not source rows.
- Validate checkpoint hash before applying.

### Risk: Target Project Transcription Loses Stable Identity

Mitigation:

- Update the target project-owned transcription row in place.
- Never replace `project_transcriptions.id` during refresh.
- Add a repository test specifically for stable ID preservation.

### Risk: Collations Appear Updated But Witnesses Remain Pinned

Mitigation:

- Show a clear note after refresh.
- Defer witness updates to Subplan 4.
- Status APIs should show stale witnesses separately.

### Risk: Promoting Overwrites Shared Source Material

Mitigation:

- First implementation creates a new library source.
- Updating existing library rows can be a later explicit flow.

## Open Questions

- Should library transcriptions get explicit commit support before refresh can use them as sources?
- Should refresh offer an immediate `Commit refreshed transcription` shortcut in the same dialog?
- Should promoted library rows link back to the source project transcription through origin fields only, or should there be a user-visible provenance panel?

## Recommended First Implementation Slice

1. Add repository command to refresh a project transcription from a committed checkpoint while preserving `projectTranscriptionId`.
2. Add status/action UI for linked project transcriptions on the Projects page.
3. Add `Refresh from source` for latest committed source only.
4. Add tests that prove no other projects or collation witnesses change.

Then add promote/add-from-project flows as a second slice.

## Second Slice Status

Complete. The second slice landed:

- `promoteProjectTranscriptionToLibrary` creates a new `scope_type='global'`/`project_id=null` library transcription from a committed project transcription checkpoint, with its own committed checkpoint so the promoted source is immediately usable for refresh, and `origin_type='project_snapshot'` provenance back to the source project. It does not mutate the source project transcription or relink the current project transcription. Blocks uncommitted sources with `PromoteUncommittedProjectTranscriptionError`.
- `addProjectTranscriptionFromProject` creates a new full project-owned transcription and `project_transcriptions` link in the target project from a committed source checkpoint, recording cross-project origin metadata. Blocks uncommitted sources (`AddFromProjectUncommittedSourceError`) and same-project reuse (`AddFromProjectSameProjectError`).
- `listProjectTranscriptionSourceCandidates` lists project transcriptions from other projects with committed/dirty status for the add-from-project picker.
- `PromoteProjectTranscriptionDialog.svelte` and `AddProjectTranscriptionFromProjectDialog.svelte` wired into `ProjectTranscriptionVersionsPanel.svelte` and the projects page with catalog/status reload after each operation.
- Targeted tests cover promote, add-from-project, candidate listing, and all blocking paths. `bun run check` (0 errors, one pre-existing triiiceratops a11y warning), `bun run db:check`, and 306 unit tests passed.
