# Files-as-Database Overview

## Purpose

This overview is the handoff document for the storage inversion described in `architecture.md`. Reading order: `architecture.md` (the target), `current-state.md` (the codebase as audited, so you do not re-audit), this overview, then the first phase document whose status is not `Completed`.

## Current Status

Overall status: `In Progress`

Current phase: `06-index-rebuild-and-repair.md`

Last updated: `2026-07-06`

## Continuation Instructions

1. Read `architecture.md`, `current-state.md`, then this overview.
2. Find the first phase in the progress ledger with status `Not Started` or `In Progress`.
3. Read that phase document before editing code.
4. Implement the smallest correct slice for that phase.
5. Update the phase document status, checklist, notes, and verification results as work completes.
6. Update this overview's progress ledger, current phase, and notes before stopping.
7. Do not mark a phase `Completed` until its completion criteria and relevant verification are done.

## Governing Decisions

Full list in `architecture.md` section 3. The short form:

- Files in OPFS are the source of truth; SQLite is a disposable index rebuilt from files.
- Transcriptions and collations always belong to a project; every user has a `Default` project.
- Cross-project sharing is copy-with-lineage; refresh-from-source is explicit; no automatic merging.
- Committed state is the sync boundary; working state is local-only files.
- Dropbox/Google Drive OAuth providers are removed. Sync targets a user-chosen local folder (Chromium File System Access API). The provider interface stays pluggable.
- Zip export/import is the universal, all-browsers backup path.
- Schema evolution is per-document migrate-on-read; the index migrates by drop-and-rebuild.
- Greenfield: no compatibility for existing browser databases.

## Progress Ledger

| Phase | Document | Status | Depends On |
| --- | --- | --- | --- |
| 1 | `01-remove-cloud-providers.md` | Completed | None |
| 2 | `02-document-store-foundation.md` | Completed | None |
| 3 | `03-canonical-file-formats.md` | Completed | Phase 2 |
| 4 | `04-project-only-data-model.md` | Completed | Phase 3 |
| 5 | `05-write-path-inversion.md` | Completed | Phase 4 |
| 6 | `06-index-rebuild-and-repair.md` | In Progress | Phase 5 |
| 7 | `07-local-folder-sync.md` | Not Started | Phases 1, 6 |
| 8 | `08-import-export.md` | Not Started | Phase 6 |
| 9 | `09-durability-and-onboarding.md` | Not Started | Phases 6-8 |
| 10 | `10-collation-regularization-single-path.md` | Not Started | Phase 5 |
| 11 | `11-editor-selection-integrity.md` | Not Started | Phase 5 |
| 12 | `12-tests-verification-docs.md` | Not Started | Phases 1-11 |

## Cross-Cutting Constraints

- Preserve the data-safety invariants in `architecture.md` section 9 at every phase boundary.
- Local save and commit must succeed even when sync writes fail; surface sync failures as status, not as failed saves.
- Keep editor routes based on owned transcription IDs; keep sync operations based on project-scoped entity IDs.
- Prefer editing `app/src/lib/client/db/migrations/0001_initial.sql` directly (greenfield); keep `schema-version.generated.ts` at version 1. The index-versioning mechanism from Phase 6 replaces SQL migrations entirely.
- Reuse existing primitives (canonical JSON hashing, quarantine codes, conflict-copy semantics, provider interface) instead of building parallel ones.
- Never store anything irreplaceable in the SQLite index.
- Each phase leaves the app building and tests passing (`bun run check`, `bun run test:unit -- --run` from `app/`).

## Key Existing Files

Data flows, table fates, constants, and legacy items are documented in `current-state.md`; the table below is only a locator.

| Area | Files |
| --- | --- |
| DB worker/runtime | `app/src/lib/client/db/db.worker.ts`, `runtime.ts`, `worker-sqlite.ts`, `worker-kysely.ts`, `worker-migrator.ts` |
| Schema | `app/src/lib/client/db/migrations/0001_initial.sql`, `types.generated.ts` |
| Repositories | `app/src/lib/client/db/repositories/*.ts` |
| Cloud file formats | `app/src/lib/client/sync/cloud-files.ts`, `canonical-json.ts`, `cloud-paths.ts` |
| Sync | `app/src/lib/client/sync/sync-manager.ts`, `conflicts.ts`, `project-restore.ts`, `provider-factory.ts` |
| Providers | `app/src/lib/client/sync/providers/*.ts`, `local-folder-handles.ts`, `local-folder-connections.ts` |
| Transcription content | `app/src/lib/client/transcription/content.ts`, `packages/tei-transcription/src/*` |
| Transcription editor | `app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte`, `app/src/lib/client/transcriptionEditorStructure.ts` |
| Collation state | `app/src/lib/client/collation/collation-state.svelte.ts`, `collation-document.ts`, `collation-projection.ts` |
| Projects UI | `app/src/routes/projects/+page.svelte`, `app/src/lib/components/projects/*.svelte` |

## Verification Commands

Run from `app/` unless noted.

```bash
bun run db:generate
bun run db:check
bun run check
bun run test:unit -- --run
```

Run narrower tests during each session when possible, then run the full baseline before handing off a completed phase.

## Progress Notes

| Date | Note |
| --- | --- |
| 2026-07-06 | Phase 6 bulk verse query slice completed. Collation verse gathering now uses a new bulk `listVerseIndexRowsForTranscriptions()` repository/worker/client path instead of issuing one serialized worker request per selected transcription. Verification passed: focused verse-index/gather/transcriptions tests (14 passed), `bun run check`, `bun run db:check`, and full `bun run test:unit -- --run` (372 passed). Phase 6 remains in progress for content-cache demotion, repair UI/RPC, auto-rebuild on failed open/integrity check, hash-based verse-index staleness skip, rebuild label RPC loop removal, single-parse indexing, and delete-the-index invariant coverage. |
| 2026-07-06 | Phase 6 stale index cleanup slice completed. After a fresh versioned index is successfully rebuilt from canonical files, startup now removes old root-level `apatosaurus-index-v*` and `apatosaurus-local-v1*` files plus old nested `apatosaurus/v1/index/apatosaurus-index-v*` versions while preserving the current index and current WAL/SHM companions. Verification passed: focused cleanup test, DB/store unit slice (97 passed), `bun run check`, `bun run db:check`, and full `bun run test:unit -- --run` (371 passed). Phase 6 remains in progress for content-cache demotion, repair UI/RPC, auto-rebuild on failed open/integrity check, verse-index performance, and delete-the-index invariant coverage. |
| 2026-07-06 | Phase 6 started. Runtime SQL migrations are replaced by index version constants and a fresh-create schema path for `apatosaurus/v1/index/apatosaurus-index-v1.db`; `schema_migrations` is removed from the greenfield schema/generated types. Fresh versioned DB startup now rebuilds the disposable index from canonical project manifests, primaries, history checkpoints, and tombstones with quarantine/orphan reporting and parent-first checkpoint insertion. Verification passed: `db:generate`, `db:check`, `check`, focused index/schema/maintenance tests, DB/store unit slice, and full `bun run test:unit -- --run` (370 passed). Phase 6 remains in progress for stale index cleanup, cache demotion, repair UI/RPC, auto-rebuild on failed open/integrity check, verse-index performance, and delete-the-index invariant coverage. |
| 2026-07-05 | Phase 5 completed. Automated crash-ordering coverage now exercises transcription and collation commit failures at history-write, primary-write, manifest-write, TEI, and post-manifest/pre-index boundaries, and a headless Chromium OPFS smoke test created/committed a transcription and collation through the real DB worker, hash-validated canonical manifest/primary/history/working files, verified TEI siblings, and listed the expected OPFS layout. Verification passed: focused file repository tests (25 passed), `bun run check`, full `bun run test:unit -- --run` (369 passed), `bun run db:check`, and the OPFS layout smoke test. Current phase is now `06-index-rebuild-and-repair.md`. |
| 2026-07-05 | Phase 5 crash-ordering slice completed. Added transcription and collation commit failure tests for history-write failure, primary-write failure, and post-manifest/pre-index insertion failure, complementing existing manifest-failure and non-blocking TEI coverage. Verification passed: focused file repository tests (25 passed), `bun run check`, full `bun run test:unit -- --run` (369 passed), and `bun run db:check`. Phase 5 remains in progress; only the manual OPFS layout smoke test remains before completion. |
| 2026-07-05 | Phase 5 load/locking slice completed. Transcription and collation loads now prefer canonical working files, then committed primary files via migrate-on-read with revision-hash validation, before falling back to SQLite cache rows with warnings. Project-scoped `navigator.locks` now guard transcription commit, collation commit, and deletion file sequences, with context reloaded after lock acquisition to preserve serialized parent/tombstone metadata. Verification passed: focused file/deletion repository tests, `bun run check`, `bun run db:check`, and full `bun run test:unit -- --run` (363 passed). Phase 5 remains in progress; remaining work is crash-ordering tests for each commit step boundary and the manual OPFS layout smoke test. |
| 2026-07-05 | Phase 5 creation slice completed. DB-worker transcription/collation create RPCs now use file-aware wrappers: transcription creation writes initial history/primary/TEI/manifest files before publishing the initial committed head to SQLite, and collation creation seeds a setup-phase canonical working document then commits it through the same file-first sequence while leaving `collation_artifacts` empty. Verification passed: focused transcription/collation file persistence tests, `bun run db:check`, `bun run check`, and full `bun run test:unit -- --run` (359 passed). Phase 5 remains in progress; remaining work is primary-file load preference beyond working files, broader crash-boundary coverage, project manifest updates on non-commit writes, and locking. |
| 2026-07-05 | Phase 5 deletion slice completed. DB-worker transcription/collation deletes now write canonical tombstone files, record tombstone heads in `project.json`, remove SQLite index rows, best-effort remove committed primaries, and preserve history files; manifest-failure tests assert the old index/primary remain intact with only a recoverable tombstone file written. Manifest tombstone heads now use canonical entity-scoped tombstone paths. Verification passed: `bun run db:check`, `bun run check`, focused and adjacent deletion/file persistence tests, and full `bun run test:unit -- --run` (357 passed). Phase 5 remains in progress; remaining work is creation file paths, primary-file load preference beyond working files, broader crash-boundary coverage, project manifest updates on non-commit writes, and locking. |
| 2026-07-05 | Phase 5 collation commit slice completed. DB-worker collation commits now write canonical history checkpoint files, committed primary files, best-effort TEI, and `project.json` manifest heads before updating SQLite; commits prefer valid working collation files so `collation_artifacts` can remain unused on the autosave path. Added a revision helper and regression tests for successful file contents, manifest-failure ordering with unchanged index state, non-blocking TEI failure, and clean status after working-file commit. Verification passed: `bun run db:check`, `bun run check`, focused collation/revision file tests, and full `bun run test:unit -- --run` (353 passed). Phase 5 remains in progress; remaining work is creation/deletion file paths, primary-file load preference beyond working files, broader crash-boundary coverage, project manifest updates on non-commit writes, and locking. |
| 2026-07-05 | Phase 5 transcription commit slice completed. DB-worker transcription commits now write canonical history checkpoint files, committed primary files, best-effort TEI, and `project.json` manifest heads before updating SQLite; history overwrites are refused and TEI failures remain non-blocking. Added reusable manifest writer plus regression tests for successful file contents, manifest-failure ordering with unchanged index state, and non-blocking TEI failure. Verification passed: `bun run db:check`, `bun run check`, focused transcription file tests, and full `bun run test:unit -- --run` (350 passed). Phase 5 remains in progress; remaining work is collation commit, creation/deletion file paths, primary-file load preference beyond working files, full crash-boundary coverage, project manifest updates on non-commit writes, and locking. |
| 2026-07-05 | Phase 5 collation autosave slice completed. DB-worker collation autosave now writes `apatosaurus.working.collation` files first, keeps projection/metadata as post-file index updates, leaves `collation_artifacts` unused on the autosave path, and loads/status-checks from valid working files via migrate-on-read during the transition. Verification passed: `bun run db:check`, `bun run check`, focused collation/transcription file repository tests, and full `bun run test:unit -- --run` (347 passed). Phase 5 remains in progress; remaining work is committed primary/history/manifest write sequences, creation/deletion file paths, crash-ordering tests, project manifest updates, and locking. |
| 2026-07-04 | Phase 5 started. First slice routed transcription autosave through OPFS working files at the DB-worker boundary before updating the SQLite cache/verse index, made `getTranscription` prefer a valid working file via migrate-on-read when present, and enforced the editor-side single-writer rule by updating `canonicalDocument` only after local persistence succeeds. Verification passed: `bun run check`; focused transcription repository tests; full `bun run test:unit -- --run` (343 passed). Remaining Phase 5 work: committed primary/history/manifest write sequence, creation/deletion, collation autosave/commit, project manifest updates, locking, and crash-ordering tests. |
| 2026-07-04 | Phase 4 completed. Final slice removed the leftover persisted project-transcription `scope_type: project_snapshot` field from canonical project-transcription files, the cloud-file adapter, and import input, with a regression assertion that new serialized files omit it. Verification passed: `db:generate`, `db:check`, `check`, focused format/sync tests, and full `bun run test:unit -- --run` (340 passed). Temporary source/payload cache columns remain for Phase 5/6, and legacy `cloud_*` sync-state tables remain for Phase 7 as explicitly documented in `04-project-only-data-model.md`. Next phase is `05-write-path-inversion.md`. |
| 2026-07-04 | Phase 4 promote API removal slice deleted the remaining dead promote-to-library API/RPC/client/repository surface and removed the two tests that only asserted the stub threw; cross-project copy remains via `addProjectTranscriptionFromProject`. Verification passed: `db:check`, `check`, focused rerun of a transient Chromium import failure, and full `bun run test:unit -- --run` (340 passed). Phase 4 remains in progress with temporary payload/cache columns deferred to Phase 5 and legacy cloud sync-state tables deferred to Phase 7. |
| 2026-07-04 | Phase 4 account-column cleanup slice removed `projects.owner_id` and `project_transcriptions.added_by_id` from the greenfield index schema and all repository/sync insert paths. Verification passed: `db:generate`, `db:check`, `check`, and full `bun run test:unit -- --run` (342 passed). Phase 4 remains in progress; legacy cloud sync-state tables and temporary payload/cache columns remain deferred as documented in `04-project-only-data-model.md`. |
| 2026-07-04 | Phase 4 second slice reworked for code quality: removed `transcriptions.scope_type`, made `project_id` `NOT NULL` on transcriptions and collations, marked `content_json`, `collation_artifacts.payload`, and checkpoint `payload` columns as temporary cache/source columns, restored sync-layer tests, re-enabled refresh/add-from-project tests, and removed the live promote-to-library UI while keeping the repository rejection for direct calls. Checkpoint payload columns and legacy `cloud_*` sync tables remain until Phase 5/7 so refresh, witness refresh, add-from-project, backup, and restore keep working. Verification passed: `db:generate`, `db:check`, `check`, and full `bun run test:unit -- --run` (342 passed). |
| 2026-07-04 | Phase 4 started. First slice landed project storage slugs, `Default` project bootstrap, project-owned transcription creation with automatic `project_transcriptions` rows, and project selection/defaulting in new transcription, TEI, IGNTP import, and harness flows. Verification passed: `db:generate`, `db:check`, `check`, focused repository/creation tests, and full unit suite. Phase 4 remains in progress; next work is removing remaining global/promotion semantics, `scope_type`, cloud sync-state tables, and source-of-truth payload columns from the index schema. |
| 2026-07-04 | Phase 3 completed. Added canonical `store/formats` modules and registry entries for all eight document formats, moved sync cloud-file parsing/serialization to a canonical-envelope adapter, folded IIIF into the project-transcription payload, defined working-state formats, and added derived TEI serializers for transcriptions and collations. Verification passed: `db:generate`, `db:check`, `check`, focused format/sync tests, and full unit suite. Next phase is `04-project-only-data-model.md`. |
| 2026-07-03 | Phase 2 completed. Added the OPFS document store foundation under `app/src/lib/client/store/`: canonical path builders, atomic text writes with fallback, document envelopes, migrate-on-read registry, in-memory quarantine reporting, and fixture-backed tests. Verification passed: `db:generate`, `db:check`, `check`, focused store tests, and full unit suite. Next phase is `03-canonical-file-formats.md`. |
| 2026-07-03 | Phase 1 completed. Manual Chromium smoke test passed after folder creation fix: connect local folder, commit project-owned transcription, back up project, and verify files in selected folder. Next phase is `02-document-store-foundation.md`. |
| 2026-07-03 | During Phase 1 smoke testing, fixed missing local-folder default path creation. Backup now creates `Apatosaurus/Projects/<project-id>` on first backup and updates the stored folder binding. Full verification still passes. |
| 2026-07-03 | Phase 1 code removal implemented: direct Dropbox/Google Drive providers, PKCE/OAuth plumbing, account placeholder routes, and token persistence are removed; provider factory is local-folder/mock only. Automated verification passed (`db:generate`, `db:check`, `check`, unit tests, straggler searches). Chromium manual folder smoke test remains pending, so Phase 1 is not yet marked completed. |
| 2026-07-03 | Plans replaced following storage-inversion audit. Supersedes cloud_sync sessions (completed, formats retained and promoted) and project-only-transcriptions plan (not started, folded into Phase 4). Implementation not started. |
