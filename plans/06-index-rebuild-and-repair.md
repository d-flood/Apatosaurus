# Phase 06: Index Versioning, Rebuild, and Repair

Status: Not Started
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

- [ ] Versioned index filename + fresh-create-or-open logic
- [ ] Old migration machinery removed; single create-schema SQL
- [ ] `rebuildIndexFromStore()` with report, idempotent, tested
- [ ] Stale index files and legacy DB cleaned up after successful rebuild
- [ ] Content cache columns demoted per decision; reads come from files
- [ ] Repair UI action with report display
- [ ] Auto-rebuild on open failure/integrity failure
- [ ] Verse indexing: hash-based staleness skip, label RPC loop removed, bulk verse query, single-parse rule; pre-collation rebuild is near-instant on unchanged transcriptions
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
