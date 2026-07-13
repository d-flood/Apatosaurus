# Ticket 08: Zip Export

Architecture reference: `../architecture.md` sections 3 (decision 7), 9 (invariant 9)

## What to build

A user can export any project as a zip archive of its exact canonical folder contents, and export all projects at once for whole-account backup. The download works in every supported browser (Chromium, Firefox, Safari) via a blob URL. Where folder sync is unavailable (non-Chromium), the UI presents export as the supported backup path.

End-to-end: an export action in the project UI reads the project folder from the OPFS store, packages it, and triggers a download named `<project-slug>-<date>.zip`. An "include drafts" toggle (off by default) adds working files, clearly labeled as drafts in the UI.

## Where to start

- `app/src/lib/client/store/opfs-store.ts` and `layout.ts` — reading a project folder's canonical files; `layout.ts` knows which paths are local-only.
- `app/src/lib/components/projects/ProjectBackupPanel.svelte` and `app/src/routes/projects/+page.svelte` — where the export action surfaces.
- `app/src/lib/client/sync/sync-manager.ts` — the Ticket 07 mirror already computes the "canonical files minus local-only" file set; reuse that enumeration rather than re-deriving it.
- Zip mechanics: a small zip library or a `CompressionStream`-based store-only zip. Store-only (uncompressed) entries are acceptable; correctness over ratio.

## Contract

- Archive contents are byte-identical to the project folder: manifest, committed primaries, `history/`, `tombstones/`, derived `*.tei.xml`.
- `*.working.json` and `app/` are excluded by default; the drafts toggle includes working files only.
- Entry paths inside the archive are relative to the project folder root (so import can resolve them without guessing).
- "Export all projects" produces one archive with a top-level directory per project slug (or one zip per project — pick one, document it in the code, and keep ticket 09's import compatible).
- Stream entries where the approach allows; do not require buffering an entire large project in memory.

## Out of scope

- Zip import and the staging/validation pipeline (ticket 09).
- Import-from-folder (ticket 10).
- The backup-health panel and export-recency tracking (ticket 13) — but write the "last exported" timestamp somewhere ticket 13 can read (e.g. `app/settings.json` or an index row) if trivial; otherwise leave a note in TRACKER.md.
- Any change to sync behavior.

## Acceptance criteria

- [ ] Exporting a project with committed transcriptions and collations yields a zip whose entries match the OPFS project folder byte-for-byte, minus `*.working.json`.
- [ ] The drafts toggle adds `*.working.json` entries and nothing else.
- [ ] "Export all projects" covers every project in the store.
- [ ] A non-Chromium capability path shows export as the backup option (unit-testable message/flag, not a manual-only behavior).
- [ ] Unit tests cover archive content selection (default vs drafts) against the memory store backend.
- [ ] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/client/store src/lib/client/sync
bun run check && bun run test:unit -- --run
```

Success: focused suites and the full unit suite pass with the new export tests included.

## Blocked by

- 06 (`06-index-rebuild-and-repair.md`) - export-all must enumerate and report canonical projects independently of a stale/rebuilt index.

## Review Remediation (2026-07-13)

Ticket 08 is reopened because project export works, but the complete backup contract is not restorable or safe for large projects.

### Required fixes

- Make export-all import-compatible. Either teach ticket 09 to import the current top-level `<project-slug>/...` multi-project archive with independent project collisions, or export separately downloadable project zips. Document and test the choice end to end.
- Enumerate canonical project folders from the store, not only rows from a possibly stale index. Validate each `project.json`; report invalid/missing manifests rather than silently omitting folders.
- Avoid simultaneously retaining every file as strings, encoded copies, ZIP chunks, and a final buffer. Use streaming ZIP generation where possible or a bounded-memory implementation. Detect/report ZIP32 count, size, and offset limits instead of wrapping fields.
- Preserve exact entry bytes. Stop decoding/re-encoding through strings when the ZIP layer can accept bytes, so future non-text files remain intact.
- Ensure draft inclusion/restoration covers both transcription and collation working files and appears clearly in import reports.

### Required tests

- Export a complete project with both primaries, both history trees, tombstones, both TEI siblings, and both working formats; compare every entry byte-for-byte.
- Export all projects and restore each through ticket 09, including independent collisions.
- Stale or rebuild the index before export-all and prove canonical folders remain covered.
- Exercise ZIP size/count boundaries and assert a clear error instead of corruption.
- Add browser download coverage for compatible Chromium, Firefox, and Safari blob-URL lifecycle behavior.

Completion gate: every advertised project/all-project backup can be imported by the product, with explicit bounded behavior for realistic large corpora.
