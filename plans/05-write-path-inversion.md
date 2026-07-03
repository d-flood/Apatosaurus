# Phase 05: Write-Path Inversion

Status: Not Started
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

- [ ] Transcription autosave writes working file first; single-writer rule enforced
- [ ] Collation autosave writes working file first; artifacts table no longer written
- [ ] Commit sequence implemented for transcriptions, ordering-tested
- [ ] Commit sequence implemented for collations, ordering-tested
- [ ] Creation writes initial committed version through the file path
- [ ] Deletion writes tombstone, preserves history
- [ ] Loads read from files via migrate-on-read; fallback hits logged
- [ ] Crash-ordering tests for each commit step boundary
- [ ] `navigator.locks` (or documented alternative) around commit sequences
- [ ] `bun run check` and `bun run test:unit -- --run` pass

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
