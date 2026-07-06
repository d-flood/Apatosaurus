# Phase 05: Write-Path Inversion

Status: Completed
Depends on: Phase 04
Architecture reference: `architecture.md` sections 6, 9

## Goal

Make files the write target. Autosave writes working files; commit writes history + primary + derived TEI + manifest, in that order; the index is updated after files succeed. Enforce the single-writer rule for the in-memory canonical document.

The current save/commit flows being replaced are documented in `current-state.md` sections 4-5 (transcription: `getJSON -> fromProseMirror -> mergeWithCanonicalDocument -> serialize -> updateTranscriptionContent`; collation: `scheduleSave -> persistDocument` writing artifact + projection). Read those first.

## Scope

### Autosave

1. Transcription autosave (`TranscriptionEditor.svelte` debounced save -> `updateTranscriptionContent`):
   - Serialize the working document; atomic-write `transcriptions/<id>.working.json` via the store.
   - After the file write resolves, update index rows (metadata, verse index) and only then replace the in-memory canonical document. No mutation of `canonicalDocument` at scheduling time (this is the single-writer rule; see Phase 11 for the editor-side consequences).
   - On startup, if a working file exists and differs from the committed primary, load the working file and show the existing draft indicator.
2. Collation autosave (`collation-state.svelte.ts` `persistDocument`):
   - Same pattern: `collations/<id>.working.json` first, then projection/index rows.
   - `collation_artifacts` stops being written; delete the table or leave it empty behind a clearly-marked flag removed in Phase 6. Projections remain as index-only read models rebuilt from the document.

### Commit

3. Implement the commit sequence from `architecture.md` section 6 for both entity types:
   1. flush working save
   2. build committed document, hash via canonical JSON
   3. write history checkpoint file (append-only)
   4. atomic-write committed primary `<id>.json`
   5. best-effort derived `<id>.tei.xml` (log + surface failure; never block)
   6. update `project.json` manifest heads (always last)
   7. update index rows (`current_revision_id`, `current_content_hash`, checkpoint listing)
4. Creation flows write the initial committed version through the same sequence (per Phase 04 decision).
5. Deletion writes a tombstone file and removes the primary (history is retained), then updates manifest and index.

### Reads

6. Entity load paths (`transcription/[id]/+page.ts`, collation `[id]/+layout.svelte`) read through the store (working file if present, else committed primary, via migrate-on-read), falling back to index cache columns only if the file is missing (transition safety). Record any fallback hits to the console as warnings; they indicate an inversion gap.

## Non-Goals

- Index rebuild (Phase 6). During this phase the index is still populated by normal writes.
- Sync (Phase 7). The manifest and files written here are exactly what sync will mirror.
- Removing the `content_json` cache column (Phase 6 decides after rebuild exists).

## Design Notes

- Route all file writes through the store worker RPC; do not open OPFS handles from window context.
- Crash-ordering tests matter more than happy-path tests here: simulate failure between each commit step and assert the invariant "old manifest + valid entity files" (`architecture.md` section 9.6). The store's atomic-write tests (Phase 2) cover single files; this phase covers the sequence.
- Concurrency: a second tab must not corrupt files. `OPFSCoopSyncVFS` already coordinates the index; for the store, rely on single dedicated worker + `navigator.locks` around commit sequences (one lock per project). Document the locking choice in Notes.
- Keep commit UX unchanged (message, author) - only the persistence target moves.

## Checklist

- [x] Transcription autosave writes working file first; single-writer rule enforced
- [x] Collation autosave writes working file first; artifacts table no longer written
- [x] Commit sequence implemented for transcriptions, ordering-tested
- [x] Commit sequence implemented for collations, ordering-tested
- [x] Creation writes initial committed version through the file path
- [x] Deletion writes tombstone, preserves history
- [x] Loads read from files via migrate-on-read; fallback hits logged
- [x] Crash-ordering tests for each commit step boundary
- [x] `navigator.locks` (or documented alternative) around commit sequences
- [x] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

Every save and commit lands in OPFS files before the index. Manual smoke test: create project, transcribe, commit, collate, commit, then inspect the OPFS folder (via devtools or a debug route) and confirm the full layout from `architecture.md` section 4 exists with valid, hash-verified contents.

## Verification

```bash
cd app
bun run test:unit -- --run src/lib/client/store src/lib/client/db src/lib/client/collation
bun run check && bun run test:unit -- --run
```

## Notes

| Date | Note |
| --- | --- |
| 2026-07-05 | Phase 5 completed. A temporary headless Chromium smoke script exercised the real app DB worker and browser OPFS store: create project, create/update/commit transcription, create/update/commit collation, read the OPFS project folder, hash-validate manifest/primary/history/working JSON files, verify committed manifest heads, verify TEI siblings, and list the expected `project.json`, `transcriptions/`, `collations/`, and `history/` layout. Verification passed: focused file repository tests (25 passed), `bun run check`, full `bun run test:unit -- --run` (369 passed), `bun run db:check`, and the headless OPFS layout smoke test. Next phase is `06-index-rebuild-and-repair.md`. |
| 2026-07-05 | Phase 5 crash-ordering slice completed. Added transcription and collation commit failure coverage at the history-write, primary-write, and post-manifest/pre-index boundaries, alongside the existing manifest-failure and non-blocking TEI assertions. The tests assert that failed history writes leave no primary/manifest/index state, failed primary writes leave only append-only history files, and index insertion failures can leave manifest + entity files ahead of the rebuildable SQLite heads. Verification passed: focused `bun run test:unit -- --run src/lib/client/db/repositories/transcription-files.spec.ts src/lib/client/db/repositories/collation-files.spec.ts` (25 passed); `bun run check`; full `bun run test:unit -- --run` (369 passed); `bun run db:check`. Phase 5 remains in progress pending the manual OPFS layout smoke test. |
| 2026-07-05 | Phase 5 load/locking slice completed. DB-worker transcription and collation load wrappers now prefer valid working files, then committed primary files read through migrate-on-read with revision-hash validation, before falling back to SQLite cache rows with warnings. Added project-scoped write locks via `navigator.locks` around transcription commit, collation commit, and deletion file sequences, with an unavailable-API fallback and locked-context reloads so parent revisions/tombstone metadata reflect serialized write order. Verification passed: focused `bun run test:unit -- --run src/lib/client/db/repositories/transcription-files.spec.ts src/lib/client/db/repositories/collation-files.spec.ts src/lib/client/db/repositories/entity-deletion.spec.ts`; `bun run check`; `bun run db:check`; full `bun run test:unit -- --run` (363 passed). Phase 5 remains in progress; remaining work is crash-ordering tests for each commit step boundary and the manual OPFS layout smoke test. |
| 2026-07-05 | Phase 5 creation slice completed. DB-worker transcription and collation create RPCs now route through file-aware creation wrappers. Transcription creation creates the index seed row, then writes an initial committed checkpoint history file, primary project-transcription file, derived TEI file, and `project.json` manifest before publishing the initial committed head to SQLite. Collation creation seeds a setup-phase canonical collation document into a working file, commits that through the existing collation file-first sequence, writes derived TEI, and keeps `collation_artifacts` empty. Added regression tests for initial transcription/collation history files, primary files, manifest heads, TEI output, committed index heads, and empty collation artifact storage. Verification passed: focused `bun run test:unit -- --run src/lib/client/db/repositories/transcription-files.spec.ts src/lib/client/db/repositories/collation-files.spec.ts`; `bun run db:check`; `bun run check`; full `bun run test:unit -- --run` (359 passed). Phase 5 remains in progress; remaining work is primary-file load preference beyond working files, broader crash-boundary coverage, project manifest updates on non-commit writes, and locking. |
| 2026-07-05 | Deletion slice completed. DB-worker transcription/collation delete RPCs now route through a file-aware wrapper that writes or reuses a canonical tombstone file, transactionally records the tombstone, removes the entity from the SQLite index, writes `project.json` with the tombstone head, and then best-effort removes the committed primary while leaving history files intact. The ordering deliberately keeps the primary until after the manifest transaction, so a manifest-write failure leaves the old index/manifest and primary intact plus a recoverable tombstone file. Manifest tombstone heads now use the canonical entity-scoped tombstone path (`tombstones/<entity-type>--<entity-id>.json`). Added regression tests for transcription and collation tombstone contents, manifest heads, primary removal, history preservation, manifest-failure rollback, and non-blocking primary-delete failure. Verification passed: `bun run db:check`; `bun run check`; focused `bun run test:unit -- --run src/lib/client/db/repositories/entity-deletion.spec.ts`; adjacent `bun run test:unit -- --run src/lib/client/db/repositories/entity-deletion.spec.ts src/lib/client/db/repositories/transcription-files.spec.ts src/lib/client/db/repositories/collation-files.spec.ts`; full `bun run test:unit -- --run` (357 passed). Remaining Phase 5 work: creation file paths, primary-file load preference beyond working files, broader crash-boundary coverage, project manifest updates on non-commit writes, and locking. |
| 2026-07-05 | Collation commit slice completed. DB-worker `revisions.commitCollation` now uses a file-first wrapper that prefers a valid working collation file, writes append-only checkpoint history, committed collation primary, best-effort derived TEI, and `project.json` manifest heads before inserting the checkpoint/head into SQLite. The wrapper refuses to overwrite existing history files; derived TEI failures are logged and do not block the commit. Added a revision helper so the SQLite checkpoint payload/hash matches the OPFS files even while `collation_artifacts` remains unused on the autosave path. Added regression tests for successful canonical files, manifest-failure ordering with unchanged index state, non-blocking TEI failure, and clean status after committing from a working file. Verification passed: focused `bun run test:unit -- --run src/lib/client/db/repositories/collation-files.spec.ts src/lib/client/db/repositories/revisions.spec.ts`; `bun run check`; `bun run db:check`; full `bun run test:unit -- --run` (353 passed). Remaining Phase 5 work: creation/deletion file paths, primary-file load preference beyond working-file loads, broader crash-boundary coverage, project manifest updates on non-commit writes, and locking. |
| 2026-07-05 | Transcription commit slice completed. DB-worker `revisions.commitTranscription` now uses a file-first wrapper that writes append-only checkpoint history, committed project-transcription primary, best-effort derived TEI, and `project.json` manifest with the new head before inserting the checkpoint/head into SQLite. The wrapper refuses to overwrite an existing history file; derived TEI write failures are logged and do not block the commit. Added a reusable project manifest file writer for later collation/creation/deletion slices and regression tests for successful canonical files, manifest-failure ordering that leaves SQLite unchanged, and non-blocking TEI failure. The lower-level checkpoint repository remains DB-only for import/sync/test compatibility during the transition. Verification passed: `bun run db:check`; `bun run check`; focused `bun run test:unit -- --run src/lib/client/db/repositories/transcription-files.spec.ts`; full `bun run test:unit -- --run` (350 passed). Remaining Phase 5 work: collation commit sequence, creation/deletion file paths, primary-file load preference beyond working-file loads, full crash-boundary coverage, project manifest updates on non-commit writes, and locking. |
| 2026-07-05 | Collation autosave slice completed. DB-worker `collations.saveArtifact` now writes an `apatosaurus.working.collation` file under the project storage slug before any projection/metadata index updates, returns a stable artifact id to preserve the existing UI contract, and no longer writes `collation_artifacts` on the autosave path. DB-worker `collations.load`, `collations.getVersionStatus`, and project collation status listing prefer a valid working file via migrate-on-read and fall back to the index cache with warnings during the transition; the legacy repository artifact writer remains only for import/sync compatibility until Phase 6. Added regression tests for file-first failure ordering, canonical working-file contents, reload from a working file with an empty artifact cache, and dirty-status hashing from the working file. Verification passed: `bun run db:check`; `bun run check`; focused `bun run test:unit -- --run src/lib/client/db/repositories/collation-files.spec.ts src/lib/client/db/repositories/transcription-files.spec.ts src/lib/client/db/repositories/collations.spec.ts`; full `bun run test:unit -- --run` (347 passed). Remaining Phase 5 work: committed primary/history/manifest write sequence, creation/deletion, commit ordering/crash tests, project manifest updates, and locking. |
| 2026-07-04 | Phase 5 started with the transcription working-file slice. DB-worker `transcriptions.updateContent` now writes an `apatosaurus.working.transcription` file under the project storage slug using the project transcription id before updating the SQLite cache/verse index; DB-worker `transcriptions.get` reads that working file through migrate-on-read when present and falls back to the index cache during the transition. The editor no longer replaces `canonicalDocument` while scheduling autosave; it only advances the in-memory canonical document after local persistence succeeds, and legacy external-folder sync enqueue failures no longer fail the local save. Verification passed: `bun run check`; focused `bun run test:unit -- --run src/lib/client/db/repositories/transcription-files.spec.ts src/lib/client/db/repositories/transcriptions.spec.ts`; full `bun run test:unit -- --run` (343 passed). |
