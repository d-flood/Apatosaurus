# Phase 08: Import and Export

Status: Not Started
Depends on: Phase 06
Architecture reference: `architecture.md` sections 3 (decision 7), 9 (invariant 9)

## Goal

Universal, all-browsers project portability: zip export/import, import-from-folder, and the cross-project copy-with-lineage flows. This is the backup and migration story for users without folder sync.

## Scope

1. Zip export:
   - "Export project" action producing `<project-slug>-<date>.zip` containing the exact canonical folder contents (manifest, primaries, history, tombstones, derived TEI). Optional toggle to include working files, clearly labeled as drafts.
   - Implemented with a small zip library (or `CompressionStream`-based store-only zip); download via blob URL - works in every supported browser.
   - Also: "Export all projects" for whole-account backup.
2. Zip import:
   - "Import project" accepts a zip, validates every file through migrate-on-read before touching OPFS (all-or-nothing staging into a temp OPFS directory, then move into place), rebuilds index rows for the project.
   - Collision handling: same project id already present -> offer "replace (with confirmation naming the newer/older sides)" or "import as copy" (new project id + slug, lineage fields noting provenance).
3. Import from folder (Chromium):
   - Pick a directory containing a project folder; same staging/validation pipeline as zip. This subsumes the old `importCloudProject`; refactor `project-restore.ts` onto the store so zip, folder, and sync-pull share one validated ingestion path.
4. Copy-with-lineage across projects (consolidating existing dialogs):
   - "Add transcription from another project" copies the committed document into the target project (new id, `origin_*` set), through the normal Phase 5 creation path.
   - "Refresh from source": show source vs local commit hashes, require explicit confirmation, create a local checkpoint before replacing (existing draft-preservation semantics).
5. Non-Chromium messaging: wherever folder sync is unavailable, surface export/import as the supported backup path (ties into Phase 1 capability notice and Phase 9 onboarding).

## Non-Goals

- TEI-file-level import of foreign transcriptions (existing TEI importer already covers single-transcription import; unchanged here).
- Any server or share-link functionality.

## Design Notes

- The staging directory pattern (validate everything in `apatosaurus/v1/staging/<nonce>/`, then move) is the transactional backbone for all ingestion; a failed import must leave zero trace outside staging, and stale staging directories are cleaned at startup.
- Zip bomb/path traversal hygiene: entries must resolve inside the project folder; reject absolute paths and `..`.
- Import reports reuse the rebuild report shape from Phase 6 (restored counts, quarantined files, orphans).
- Keep an eye on memory: stream zip entries rather than buffering the whole archive where the library allows.

## Checklist

- [ ] Zip export (single project, all projects, optional drafts), tested
- [ ] Zip import with staging, validation, collision handling, tested
- [ ] Folder import sharing the same ingestion path, tested (Chromium)
- [ ] `project-restore.ts` refactored onto the store; sync-pull, zip, folder ingestion unified
- [ ] Copy-with-lineage and refresh-from-source flows working through file paths
- [ ] Path traversal and malformed-archive tests
- [ ] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

Round-trip guarantee holds on Chromium, Firefox, and Safari: export a project to zip, wipe site data entirely, import the zip, and the project (including history and lineage) is byte-equivalent modulo local-only files. Invariant 9 test automated where browsers allow, manual checklist otherwise.

## Verification

```bash
cd app
bun run test:unit -- --run src/lib/client/sync src/lib/client/store
bun run check && bun run test:unit -- --run
```

## Notes

| Date | Note |
| --- | --- |
