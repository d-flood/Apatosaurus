# Ticket 04: Project-Only Data Model, Index-Only Schema

Blocked by: Ticket 03
Architecture reference: `../architecture.md` sections 3 (decisions 1-3), 7

## Goal

Land the project-only ownership model (folded in from the superseded project-only-transcriptions plan) and rewrite the SQLite schema as an explicitly derived index. After this phase the schema contains nothing that cannot be rebuilt from canonical files.

## Scope

### Ownership model

1. Every transcription and collation belongs to exactly one project. Remove the `scope_type` global/`project_snapshot` split: all transcriptions are project-owned.
2. Auto-create a `Default` project on first run (and on rebuild if no projects exist yet but orphan entities are found).
3. Projects get an immutable `storage_slug` (initial name slug + unique suffix) used as the OPFS folder name. Renames never change the slug.
4. Creation and import flows require a project id, defaulting to `Default`. Creation writes an initial committed version (file-level, activated in Phase 5; until then keep the existing checkpoint write).
5. Cross-project copy keeps lineage: copying a transcription into another project duplicates the document and sets `origin_*` fields. The refresh flow (`ProjectTranscriptionRefreshDialog`) stays explicit and user-confirmed.

### Index-only schema rewrite

Edit `app/src/lib/client/db/migrations/0001_initial.sql` directly (greenfield). The full current table inventory with per-table fates is in `../current-state.md` section 3; the summary:

6. Keep, as derived tables: `projects` (plus `storage_slug`), `transcriptions` metadata columns, `transcription_verse_index`, `project_transcriptions`, `collations`, collation projection tables (`collation_witnesses`, `collation_tokens`, `collation_variation_units`, `collation_readings`, `collation_reading_witnesses`), and checkpoint rows. Checkpoint `payload` columns remain temporary until Phase 5 writes history files to OPFS at commit time.
7. Remove later: `cloud_connections`, `cloud_project_folders`, `cloud_sync_metadata` (sync state cache is redefined in Phase 7), `collation_artifacts` payload-as-truth role, and checkpoint `payload` columns. During this phase content still lives in `transcriptions.content_json`, `collation_artifacts`, and checkpoint `payload` columns as working caches; mark them clearly as cache columns slated for demotion in Phase 5/6. Record in Notes what remains temporarily.
8. Regenerate types (`bun run db:generate`), fix repositories and RPC (`db.worker.ts`, `rpc.ts`, `client.ts`) for the new shape.

### UI flows

9. Transcription library route becomes project-scoped: the `(library)` list shows transcriptions grouped by project, or moves under a project detail view (full navigation polish lands in Phase 9; here, only ensure no flow can create or show an unowned transcription).
10. New-transcription and IGNTP-import flows include project selection defaulting to `Default`.
11. Collation creation requires a project and only offers witnesses from that project's transcriptions.

## Non-Goals

- No OPFS writes from feature paths yet (Phase 5).
- No index rebuild mechanics (Phase 6).
- No navigation redesign beyond preventing unowned entities (Phase 9).

## Design Notes

- This intentionally supersedes plan documents 01-10 of the old project-only-transcriptions series; their decisions are preserved except cloud-folder specifics, which are replaced by the OPFS layout in `../architecture.md` section 4.
- Slug generation: lowercase, ASCII-fold, hyphenate, trim to ~40 chars, append short random suffix; collision-check against existing project slugs.
- Keep `owner_id`/`added_by_id` columns only if something reads them; otherwise drop (no accounts remain after Phase 1).

## Checklist

- [x] `Default` project auto-creation, tested
- [x] `storage_slug` on projects, immutable, tested
- [x] No code path creates or lists an unowned transcription or collation (collation/project_id now `NOT NULL`; transcription/project_id `NOT NULL`; promote-to-library UI/RPC/client/repository API removed)
- [x] Schema rewritten for the Phase 4 project-only model; removed columns gone; remaining temporary caches documented; types regenerated
  - Removed: `transcriptions.scope_type`. `transcriptions.project_id` and `collations.project_id` are now `NOT NULL`.
  - Removed: account-era `projects.owner_id` and `project_transcriptions.added_by_id` columns.
  - Removed from canonical project-transcription files: the obsolete `scope_type: project_snapshot` payload field.
  - Kept (with comments marking as legacy/slated for Phase 7): `cloud_connections`, `cloud_project_folders`, `cloud_sync_metadata` — these no longer store OAuth tokens, but removing them would require the Phase 7 sync rewrite.
  - Marked as cache columns (slated for Phase 5/6 demotion): `transcriptions.content_json`, `collation_artifacts.payload`, `transcription_checkpoints.payload`, `collation_checkpoints.payload`.
- [x] Repositories/RPC updated for the current schema slice; repository and restored sync tests pass
- [x] Creation/import/collation flows require project, default to `Default`
- [x] Copy-with-lineage between projects works with `origin_*` set
- [x] `bun run db:generate && bun run db:check` clean
- [x] `bun run check` and `bun run test:unit -- --run` pass

## Deferred to Later Phases

- `refreshProjectTranscription`, `addProjectTranscriptionFromProject`, collation witness refresh, and cloud history serialization still read checkpoint payloads from SQLite. This is intentional for this slice because OPFS writes from feature paths are a Phase 5 non-goal; Phase 5 should move those payloads to history files and remove the temporary DB payload columns in the same change.
- The legacy `cloud_connections` / `cloud_project_folders` / `cloud_sync_metadata` tables remain until Phase 7. The sync-layer tests remain active so backup/restore behavior does not silently regress while those tables exist.

## Completion Criteria

The app runs with the new schema; every entity has a project; the schema contains no OAuth/token tables; everything remaining is either derived or explicitly marked as a temporary cache column with a pointer to the phase that demotes it.

Phase 4 is complete with two explicit deferrals already owned by later phases: Phase 5 removes the temporary source/payload cache role by writing committed history files first, and Phase 7 removes/replaces the legacy cloud sync-state tables during the local-folder sync rewrite.

## Verification

```bash
cd app
bun run db:generate && bun run db:check
bun run test:unit -- --run src/lib/client/db
bun run check && bun run test:unit -- --run
```

Verification results:

| Date | Result |
| --- | --- |
| 2026-07-04 | Passed: `bun run db:generate`, `bun run db:check`, `bun run check`, focused repository/creation tests, and full `bun run test:unit -- --run`. |
| 2026-07-04 | Superseded by the reworked second slice below. |
| 2026-07-04 | Reworked second slice: passed `bun run db:generate`, `bun run db:check`, `bun run check`, focused repository/sync tests, and full `bun run test:unit -- --run` (342 passed) after keeping checkpoint payload columns temporary, restoring sync tests, re-enabling refresh/add-from-project tests, and removing the promote-to-library UI. |
| 2026-07-04 | Account-column cleanup slice: passed `bun run db:generate`, `bun run db:check`, `bun run check`, and full `bun run test:unit -- --run` (342 passed). |
| 2026-07-04 | Promote API removal slice: passed `bun run db:check`, `bun run check`, focused rerun of `src/lib/components/transcriptionEditor/inspector-carriers.svelte.spec.ts` after a transient Chromium import failure, and full `bun run test:unit -- --run` (340 passed). |
| 2026-07-04 | Final project-transcription scope cleanup: passed `bun run db:generate`, `bun run db:check`, `bun run check`, focused `bun run test:unit -- --run src/lib/client/store/formats/formats.spec.ts src/lib/client/sync/cloud-files.spec.ts`, and full `bun run test:unit -- --run` (340 passed). |

## Notes

| Date | Note |
| --- | --- |
| 2026-07-04 | Started Phase 4. Added immutable `projects.storage_slug` with slug generation, bootstrapped `Default` via worker init/reset and RPC/client API, and made transcription creation/import/harness flows resolve a project and create the `project_transcriptions` index row atomically. New transcription and IGNTP import UI now expose a project selector defaulting to `Default`; transcription summaries list project-owned rows instead of global rows. Remaining for later slices: remove or repurpose the promote-to-global-library path, remove the `scope_type` split, make schema tables strictly index-only, remove cloud sync state tables, and demote payload/cache columns. |
| 2026-07-04 | Reworked the second Phase 4 slice for code quality. Removed `transcriptions.scope_type`; made `transcriptions.project_id` and `collations.project_id` `NOT NULL`; kept checkpoint `payload` columns as explicitly temporary cache/source columns until Phase 5 writes OPFS history files. `refreshProjectTranscription`, `addProjectTranscriptionFromProject`, collation witness refresh, and cloud backup/restore continue to work against the temporary payload cache. `promoteProjectTranscriptionToLibrary` rejects direct calls and the project UI no longer exposes the promote-to-library flow. Restored the 4 sync-layer spec files and re-enabled the 8 refresh/add-from-project tests. |
| 2026-07-04 | Removed the remaining account-era ownership columns from the index schema: `projects.owner_id` and `project_transcriptions.added_by_id`. Updated project creation/bootstrap, project transcription link creation, restore/sync/conflict insert paths, collation mocks, and regenerated `types.generated.ts`. No user/account replacement was added because account management was removed in Phase 1. |
| 2026-07-04 | Removed the dead promote-to-library API surface entirely: repository function/input type, worker RPC branch, RPC request variant, client wrapper, project-collation wrapper/type export, and the two tests that only asserted the stub threw. Cross-project copy remains through `addProjectTranscriptionFromProject`. |
| 2026-07-04 | Completed Phase 4 by removing the leftover persisted project-transcription `scope_type: project_snapshot` field from the canonical format, sync cloud-file adapter, and import input. Added a regression assertion that newly serialized project-transcription files omit `scope_type`. Remaining `scope_type` references are only in the legacy `cloud_sync_metadata` cache, deferred to Phase 7. Temporary source/payload cache columns remain deferred to Phase 5/6 as documented above. |
