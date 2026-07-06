# Phase 06: Index Versioning, Rebuild, and Repair

Status: In Progress
Depends on: Phase 05
Architecture reference: `architecture.md` sections 7, 9 (invariant 1)

## Goal

Make the SQLite index provably disposable. Version the index file, rebuild it from canonical files on version mismatch or corruption, expose "Repair database" in the UI, and demote the remaining content-cache columns.

## Scope

1. Index versioning:
   - `INDEX_SCHEMA_VERSION` constant; DB filename becomes `apatosaurus-index-v<N>.db` (replaces `apatosaurus-local-v1.db`).
   - On worker init: if the versioned file exists, open it; otherwise create schema and rebuild from files, then delete older `apatosaurus-index-v*.db` and legacy DB files.
   - Delete `worker-migrator.ts`'s multi-migration machinery; the initial SQL becomes "create current schema" executed only on fresh index files. SQL migrations no longer exist as a concept.
2. Rebuild-from-files:
   - `rebuildIndexFromStore()`: enumerate `projects/*/`, read manifest + primaries + working files + checkpoint listings + tombstones through migrate-on-read, repopulate all index tables in one pass.
   - Produces a report: projects/entities restored, quarantined files (path + code), orphaned entity files not referenced by any manifest (surfaced as importable, never deleted).
   - Must be idempotent and safe to run on a live app (worker pauses other RPC during rebuild).
3. Demote cache columns:
   - Remove `transcriptions.content_json` as a read path; content always comes from files. Either drop the column or keep it strictly as a rebuildable cache - decide by measuring load performance; document the decision in Notes.
   - Drop `collation_artifacts` if Phase 5 left it behind a flag.
   - Checkpoint listing tables hold metadata only; payloads live exclusively in history files.
4. Repair UI:
   - A "Repair database" action (settings or projects page) that runs `rebuildIndexFromStore()` and shows the report, including quarantined/orphaned files.
   - Automatic trigger: if the index fails to open or fails an integrity check (`PRAGMA integrity_check` on init), rebuild automatically and notify the user afterward.
5. Verse index performance (fixes the known slow pre-collation rebuild; root causes in `current-state.md` section 8):
   - Staleness skip: record the indexed `content_hash` per transcription (column on the index state or on `transcription_verse_index` metadata); `replaceVerseIndexRows` and the bulk rebuild skip any transcription whose current hash matches the recorded one. The SetupPhase "rebuild" button becomes a repair action that is near-instant when nothing changed.
   - Remove the per-transcription `getTranscription()` RPC loop in `verse-index.ts` `rebuildVerseIndexForTranscriptions` (it fetches full `content_json` per transcription just to format progress labels); progress reporting moves into the single bulk RPC (worker posts progress messages) or uses a lightweight metadata-only query.
   - Add a bulk verse query RPC (`WHERE transcription_id IN (...)`) and use it in `gather-verses.ts` instead of one RPC per transcription (the worker queue serializes them anyway).
   - Single-parse rule: indexing operates on an already-parsed document when one is in hand (save path passes the document, not the JSON string); `coerceTranscriptionDocument` runs at most once per document per operation.
6. The invariant test: an integration test that populates projects through normal APIs, deletes the index database file entirely, restarts the worker, and asserts full equivalence of listings, entity loads, verse index, and collation projections after automatic rebuild.

## Non-Goals

- Sync state cache (Phase 7 defines what sync stores in the index).
- Import of *foreign* folders (Phase 8); rebuild only reads the app's own OPFS store.

## Design Notes

- Rebuild performance target: a realistic corpus (say 5 projects x 30 transcriptions x moderate size) rebuilds in seconds, not minutes. Verse indexing is the expensive part; reuse `extractVersesFromDocument` batch-wise inside a single transaction.
- Orphan handling: files present but unreferenced by a manifest happen after a crash between commit steps 4 and 6. The report offers "restore into project" (re-adds manifest head) - implement restore-into-project here since it is a manifest write plus index refresh.
- After this phase, "delete the db during development" is replaced by "bump INDEX_SCHEMA_VERSION", which exercises the exact machinery users rely on. Development churn becomes a production test.

## Checklist

- [x] Versioned index filename + fresh-create-or-open logic
- [x] Old migration machinery removed; single create-schema SQL
- [x] `rebuildIndexFromStore()` with report, idempotent, tested
- [x] Stale index files and legacy DB cleaned up after successful rebuild
- [ ] Content cache columns demoted per decision; reads come from files
- [ ] Repair UI action with report display
- [ ] Auto-rebuild on open failure/integrity failure
- [x] Verse indexing performance
  - [x] Hash-based staleness skip
  - [x] Label RPC loop removed from rebuild
  - [x] Bulk verse query replaces per-transcription `getVerseIndexRowsForTranscription()` loop in collation verse gathering
  - [x] Single-parse rule on save/rebuild paths
  - [x] Pre-collation rebuild is near-instant on unchanged transcriptions
- [ ] Delete-the-index invariant test passing
- [ ] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

Deleting `apatosaurus-index-v<N>.db` from OPFS (manually, in devtools) and reloading the app restores complete, correct state with a user-visible notice and zero data loss. Bumping `INDEX_SCHEMA_VERSION` does the same silently.

## Verification

```bash
cd app
bun run test:unit -- --run src/lib/client/db src/lib/client/store
bun run check && bun run test:unit -- --run
```

## Notes

| Date | Note |
| --- | --- |
| 2026-07-06 | Verse-index performance slice completed. Added disposable `transcription_verse_index_state` metadata with indexed content hashes and verse counts so unchanged rebuilds skip row deletion/reinsertion, removed the public adapter's per-transcription `getTranscription()` label-fetch loop, and routed autosave/update indexing through already-normalized documents so save/rebuild indexing coerces each document at most once. Verification passed: `bun run db:generate`, focused transcriptions/verse-index tests (14 passed), DB/store unit slice (99 passed), `bun run db:check`, `bun run check`, and full `bun run test:unit -- --run` (373 passed). Phase 6 remains in progress for content-cache demotion, repair UI/RPC, auto-rebuild on failed open/integrity check, and delete-the-index invariant coverage. |
| 2026-07-06 | Bulk verse query slice completed. Added `listVerseIndexRowsForTranscriptions()` through the repository, worker RPC, client bridge, and public verse-index adapter, and changed collation verse gathering to issue one bulk verse-index request for selected transcriptions instead of one serialized worker request per transcription. Verification passed: focused verse-index/gather/transcriptions tests (14 passed), `bun run check`, `bun run db:check`, and full `bun run test:unit -- --run` (372 passed). Phase 6 remains in progress for content-cache demotion, repair UI/RPC, auto-rebuild on failed open/integrity check, hash-based verse-index staleness skip, rebuild label RPC loop removal, single-parse indexing, and delete-the-index invariant coverage. |
| 2026-07-06 | Stale index cleanup slice completed. Fresh index startup now runs cleanup only after `rebuildIndexFromStore()` succeeds, removing old root-level `apatosaurus-index-v*` files, legacy `apatosaurus-local-v1*` files, and old nested `apatosaurus/v1/index/apatosaurus-index-v*` versions while preserving the current index and current WAL/SHM companions. Added focused cleanup coverage. Verification passed: focused `index-files` test, `bun run test:unit -- --run src/lib/client/db src/lib/client/store` (97 passed), `bun run check`, `bun run db:check`, and full `bun run test:unit -- --run` (371 passed). Phase 6 remains in progress for content-cache demotion, repair UI/RPC, auto-rebuild on failed open/integrity check, verse-index performance, and delete-the-index invariant coverage. |
| 2026-07-06 | Phase 6 started. Replaced runtime SQL migration bookkeeping with `INDEX_SCHEMA_VERSION = 1`, the versioned OPFS index path `apatosaurus/v1/index/apatosaurus-index-v1.db`, and a fresh-index schema creator; removed `schema_migrations` from the greenfield schema/generated types and updated reset/perf-test cleanup for both legacy root DB files and the new nested index location. Added `rebuildIndexFromStore()` for fresh versioned indexes: it scans project manifests and referenced canonical transcription/collation primaries, history checkpoints, and tombstones through migrate-on-read, repopulates listing/IIIF/verse/projection/checkpoint/tombstone index rows in one transaction, reports quarantined and orphaned files, and inserts checkpoint rows parent-first even when filenames sort out of order. Fresh worker startup now creates schema, rebuilds from files, then bootstraps the default project. Verification passed: `bun run db:generate`, `bun run db:check`, `bun run check`, focused index/schema/maintenance tests, `bun run test:unit -- --run src/lib/client/db src/lib/client/store` (96 passed), and full `bun run test:unit -- --run` (370 passed). Remaining Phase 6 work includes stale index cleanup, content-cache demotion, repair UI/RPC, auto-rebuild on open/integrity failure, verse-index performance work, and the delete-the-index invariant test. |
