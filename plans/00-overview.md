# Files-as-Database Overview

## Purpose

This overview is the handoff document for the storage inversion described in `architecture.md`. Reading order: `architecture.md` (the target), `current-state.md` (the codebase as audited, so you do not re-audit), this overview, then the first phase document whose status is not `Completed`.

## Current Status

Overall status: `In Progress`

Current phase: `02-document-store-foundation.md`

Last updated: `2026-07-03`

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
| 2 | `02-document-store-foundation.md` | Not Started | None |
| 3 | `03-canonical-file-formats.md` | Not Started | Phase 2 |
| 4 | `04-project-only-data-model.md` | Not Started | Phase 3 |
| 5 | `05-write-path-inversion.md` | Not Started | Phase 4 |
| 6 | `06-index-rebuild-and-repair.md` | Not Started | Phase 5 |
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
| 2026-07-03 | Phase 1 completed. Manual Chromium smoke test passed after folder creation fix: connect local folder, commit project-owned transcription, back up project, and verify files in selected folder. Next phase is `02-document-store-foundation.md`. |
| 2026-07-03 | During Phase 1 smoke testing, fixed missing local-folder default path creation. Backup now creates `Apatosaurus/Projects/<project-id>` on first backup and updates the stored folder binding. Full verification still passes. |
| 2026-07-03 | Phase 1 code removal implemented: direct Dropbox/Google Drive providers, PKCE/OAuth plumbing, account placeholder routes, and token persistence are removed; provider factory is local-folder/mock only. Automated verification passed (`db:generate`, `db:check`, `check`, unit tests, straggler searches). Chromium manual folder smoke test remains pending, so Phase 1 is not yet marked completed. |
| 2026-07-03 | Plans replaced following storage-inversion audit. Supersedes cloud_sync sessions (completed, formats retained and promoted) and project-only-transcriptions plan (not started, folded into Phase 4). Implementation not started. |
