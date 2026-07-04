# Current State Reference (Audit, 2026-07-03)

This document captures the codebase audit that produced `architecture.md`. It exists so implementing agents do not need to re-audit the codebase to understand what they are changing. It describes the system as it exists **before** any phase has run. As phases land, the phase documents' Notes tables are authoritative for what changed; this document is not updated retroactively.

## 1. Repository Layout

- Bun workspace rooted at the repo. Workspaces: `app/` (the SvelteKit app), `triiiceratops/` (IIIF/OpenSeadragon viewer, git submodule, used by the transcription editor's IIIF workspace), `packages/tei-transcription/` (TEI data model + conversions), `collatex/collatex-tsport/` (TypeScript CollateX port, git submodule, the alignment engine).
- `app/svelte.config.js` and `app/vite.config.ts` alias `triiiceratops` and `collatex-tsport` directly to submodule **source** files, and `$generated` to `src/generated`.
- SvelteKit 2 / Svelte 5, static adapter (`fallback: '404.html'`), Tailwind + DaisyUI, TipTap for the editor. Deployed via GitHub Pages workflow `.github/workflows/app-pages.yml`.
- Custom service worker `app/src/service-worker.ts` (network-first navigations, cache-first assets, `/offline` fallback); manual registration in `+layout.svelte` (`serviceWorker.register: false` in svelte config).
- Tests: vitest split into browser mode (Svelte/client) and node (server) in `vite.config.ts`; Playwright configured. Run everything with `bun` from `app/`.

## 2. Runtime Architecture

- `app/src/routes/+layout.svelte` on mount: `ensureLocalDbRuntime()` (starts DB worker, runs `purgeLegacyDjazzkitStorage()`), `syncService.initLocalDB('local')`, registers service worker.
- All DB access flows: UI -> `app/src/lib/client/db/client.ts` -> `rpc.ts` (typed request/response) -> `db.worker.ts` (dedicated worker, serializes all requests through a promise queue) -> `repositories/*.ts` (Kysely).
- `db.worker.ts` also handles a `reset` RPC (close, re-init, `clearDomainTables`). `maintenance.ts` has table-clearing helpers. `storage-reset.ts` exists for full wipes.
- Other workers: `collation.worker.ts` (runs CollateX), `external-sync.worker.ts` (legacy, see §7).

## 3. Database (SQLite in OPFS)

- `@journeyapps/wa-sqlite` + `OPFSCoopSyncVFS` in `worker-sqlite.ts`. Constants: `DB_FILENAME = 'apatosaurus-local-v1.db'`, `OPFS_VFS_NAME = 'apatosaurus-local-v1-opfs'`. Pragmas: `foreign_keys ON`, `busy_timeout 250`, `journal_mode WAL`, `synchronous NORMAL`.
- Kysely over a custom adapter (`worker-kysely.ts`); generated types in `types.generated.ts` via `bun run db:generate` (uses `better-sqlite3` + `kysely-codegen` in `app/scripts/db/`); `db:check` verifies.
- Migrations: single `migrations/0001_initial.sql`, applied transactionally by `worker-migrator.ts` (BEGIN/COMMIT, ROLLBACK on failure, rethrow). No backup-before-migrate. `schema-version.generated.ts` pins version 1.

### Table inventory and fate under the new architecture

| Table | Currently stores | Fate |
| --- | --- | --- |
| `schema_migrations` | applied migrations | Removed (Phase 6 replaces SQL migrations with index versioning) |
| `projects` | metadata, `collation_settings` JSON, `charter` | Kept as index; gains `storage_slug` (Phase 4); canonical copy moves to `project.json` |
| `transcriptions` | metadata + `content_json` (**source of truth today**, format `normalized_ast_v3`) + `scope_type` (`global`/`project_snapshot`) + `origin_*` lineage + `current_revision_id`/`current_content_hash` | Index-only; `scope_type` split removed (Phase 4); `content_json` demoted to cache or dropped (Phases 5-6) |
| `transcription_verse_index` | derived verse lookup, rebuilt on every content save | Kept as index (already derived) |
| `project_transcriptions` | project<->transcription join; **its `id` (not the transcription id) is the sync identity**; `canonical_transcription_id` back-reference | Kept as index; semantics simplify once all transcriptions are project-owned |
| `collations` | metadata, verse, status, revision pointers | Kept as index |
| `collation_artifacts` | `collation_document_v1` payload (**source of truth today**); legacy `workspace_state_v2`/`workspace_state_v1` read-fallbacks | Removed; document moves to files (Phases 5-6) |
| `collation_witnesses/_tokens/_variation_units/_readings/_reading_witnesses` | projection of the collation document; saves are destructive delete-all + reinsert per collation | Kept as index (already derived read models) |
| `transcription_checkpoints` / `collation_checkpoints` | full committed snapshot payloads (canonical JSON) + parent pointer + message | Payloads move to `history/` files; tables become metadata-only listings (Phases 5-6) |
| `iiif_manifest_sources`, `transcription_page_canvas_links`, `iiif_canvas_annotations` | IIIF sources/links/annotations per transcription | Folded into the transcription document format (Phase 3); tables become index if needed for queries, else dropped |
| `cloud_connections` | provider OAuth tokens (access + refresh, stored in plaintext) | Removed (Phases 1, 4) |
| `cloud_project_folders` | project -> provider folder binding, sync cursor | Removed; replaced by `app/sync-targets.json` + IndexedDB handles (Phase 7) |
| `cloud_sync_metadata` | per-entity cloud file id/revision/last-synced hash | Removed; replaced by rebuildable fingerprint cache (Phase 7) |
| `sync_tombstones` | deletion records for sync | Canonical copy moves to `tombstones/` files; index copy kept |

## 4. Transcription Data Flow (today)

- Stored format: `TRANSCRIPTION_FORMAT = 'normalized_ast_v3'` (`app/src/lib/client/transcription/content.ts`) - the normalized `TranscriptionDocument` AST from `packages/tei-transcription` (not TipTap JSON, not TEI).
- Load: `transcriptions.content_json` -> `coerceTranscriptionDocument()` -> `toProseMirror()` -> `repairManuscriptStructureJson()` (`transcriptionEditorStructure.ts`) -> `editor.commands.setContent(..., { emitUpdate: false })`.
- Save: `editor.getJSON()` -> `fromProseMirror()` -> `mergeWithCanonicalDocument()` (preserves TEI header/front/back/facsimile fields not represented in the editor) -> `serializeTranscriptionDocument()` (normalizes) -> `updateTranscriptionContent()` (updates row + rebuilds verse index in one transaction).
- Autosave: `createDebouncedAutosave(delayMs = 1000)` in `TranscriptionEditor.svelte`, on `update` when `transaction.docChanged`; flushes on `visibilitychange`, `beforeunload`, destroy, and before commit. Known hazard: the in-memory canonical document is updated during scheduling, before persistence completes (the "single-writer" violation Phase 5/11 fix).
- TEI: `parseTei`/`serializeTei` in `packages/tei-transcription`; app wrappers `app/src/lib/tei/tei-importer.ts` (`importTEI`), `tei-exporter.ts` (`exportTEI`). Import/export only; TEI is not stored.
- Cursor-adjacent code: 500ms debounced cursor tracking + `selectionUpdate` handlers + `scrollToVerse` + `InlineCarrierWorkspace.svelte` (own `setContent` calls and manual selection math). See Phase 11 inventory task.

## 5. Collation Data Flow (today)

- Run: `collation-runner.ts` extracts witness token streams from transcription ASTs (firsthand/corrector hands, lacunae, supplied, punctuation) -> `collation-state.svelte.ts` regularizes -> `collation-service.ts` posts to `collation.worker.ts` -> `collation-adapter.ts` `collateToAlignmentSnapshot()` wraps `collate({ witnesses }, { output: 'table', segmentation })` from `collatex-tsport` -> alignment columns land in state.
- Persistence: `CollationDocument` (artifact type `collation_document_v1`, defined in `collation-document.ts`) is canonical today; `collation-projection.ts` materializes the projection tables. `scheduleSave()` debounces 800ms -> `persistDocument()` writes artifact + projection + metadata. Commit: `CollationWorkspace.svelte` flushes then `createCommittedCollationCheckpoint()`.
- Regularization (the Phase 10 target): `RegularizationRule { pattern, replacement, scope: 'project'|'verse', enabled, type }`; project rules in project settings, verse rules in the collation document, merged in `project-settings.ts`. **Two application paths**: preview via `applyRegularization()` -> `regularizedTexts` map, and actual collation input via `buildWitnessInputFromWitness()` -> `deriveRegularizedToken()`. Invalid regexes are silently skipped (`regularizeTextValue` builds `new RegExp(pattern, 'g')` - no `u` flag).
- Phases/routes: `setup | alignment | readings | stemma` under `/collation/[id]/[phase]`; legacy `regularization` redirects to `alignment`. Navigation guarded by `collationState.canNavigateTo(...)`.
- Witness pinning: `collation_witnesses.source_revision_id` / `source_content_hash` pin the transcription revision each witness came from.

## 6. Sync Layer (today)

- File formats: `cloud-files.ts` defines `CloudFile = ProjectCloudFile | ProjectTranscriptionCloudFile | CollationCloudFile | HistoryCloudFile | TombstoneCloudFile`, all `schema_version: 1`, hash-validated on parse (`assertHashMatches`). Quarantine codes: `invalid_json | invalid_schema_version | invalid_shape | hash_mismatch`. These formats are what Phase 3 promotes to canonical.
- Hashing: `canonical-json.ts` (`canonicalJson`, `hashCanonicalPayload`); payload builders `buildTranscriptionHashPayload` / `buildCollationHashPayload` in `repositories/revisions.ts`.
- Manager: `sync-manager.ts` (~1,800 lines): `backupProject()` (publish entities -> tombstones -> manifest last), `publishEntity`, `syncProjectTombstones`, `OpenObjectSyncPoller` (30s base / 60s max, exponential backoff on provider errors).
- Conflicts: `conflicts.ts`: `classifyCommittedHeadSync`, `createCollationConflictCopy`, `createProjectTranscriptionConflictCopy`, `preserve*DraftCheckpoint` - preserve-both, never merge. Reuse these in Phase 7.
- Restore: `project-restore.ts`: `importCloudProject()` (full transactional import from a provider folder), `pullLinkedProjectUpdates()` (manifest comparison -> replace primaries, apply tombstones). Phase 8 refactors this onto the store as the shared ingestion path.
- Providers: `providers/provider.ts` (interface + typed errors), `local-folder-provider.ts` (FS Access API, `createWritable()`), `dropbox-provider.ts` + `google-drive-provider.ts` (deleted in Phase 1), `mock-provider.ts` (tests). `provider-factory.ts` selects. `local-folder-handles.ts` persists `FileSystemDirectoryHandle`s in IndexedDB. `cloud-auth.ts` + `auth/pkce.ts` are OAuth-only (deleted in Phase 1).

## 7. Legacy / Cleanup Inventory

Items that exist today and need an explicit fate; agents should not build around them silently:

- **Legacy external transcription folder sync**: `app/src/lib/client/transcription/external-sync-service.ts` + `external-sync.worker.ts`, integrated into the transcription library page (`(library)/+page.svelte` via `externalSyncService`). Predates the provider system; syncs transcription files to a picked directory with its own IndexedDB handle storage. **Retired in Phase 7** (superseded by project folder sync). Do not extend it.
- `legacy-djazzkit-purge.ts`: one-time storage purge run at startup. Keep until Phase 6, then fold into index-startup cleanup or delete.
- `/accounts/login` and `/accounts/register` routes: OAuth-era. Phase 1 removes if nothing else uses them.
- `ProjectUserManagementStub.svelte`: stub; Phase 9 keeps-as-stub or removes.
- Old plan documents at repo root and `plans/` were deleted 2026-07-03; the cloud_sync session docs describe how the current sync layer was built if archaeology is needed (`git log`).
- `ideas.md` (repo root): small backlog (punctuation handling in collation, collation undo/redo, image caching). Triaged in Phase 12.

## 8. Known Bug and Performance Root Causes (for Phases 6, 10-11)

- **Cursor jumps** (Phase 11): (a) `setContent` invoked outside initial load via repair/merge paths remaps positions; (b) canonical-document mutation races autosave (fixed by Phase 5 single-writer rule); (c) selection-reactive handlers that dispatch document changes create feedback loops.
- **Inconsistent collation rules** (Phase 10): dual derivation paths (preview vs collation input), silent regex-compile failures, no `u` flag / Unicode normalization on Greek text, and no staleness marking when rules change after an alignment run.
- **Slow pre-collation verse indexing** (Phase 6): four compounding causes.
  1. No staleness check anywhere: `rebuildVerseIndexForTranscriptions` (`repositories/transcriptions.ts:248`) unconditionally re-parses (`JSON.parse` + `normalizeDocument`), re-walks, deletes and reinserts index rows for every transcription, sequentially in one transaction, even when content is unchanged. `last_indexed_at` is write-only; `current_content_hash` is never consulted.
  2. The client wrapper (`transcription/verse-index.ts:139`) sequentially awaits a full `getTranscription(id)` RPC per transcription (shipping entire `content_json` payloads) solely to format progress labels, before issuing the single bulk rebuild RPC.
  3. `gatherVerses` (`collation/gather-verses.ts:84`) issues one `getVerseIndexRowsForTranscription` RPC per transcription inside `Promise.all`, but `db.worker.ts`'s promise queue serializes them; there is no `IN (...)` bulk query.
  4. Save-path double parse: `updateTranscriptionContent` serializes the in-memory document to JSON, then `replaceVerseIndexRows` immediately re-parses and re-normalizes that same string.
  - Note also: `extractVersesFromDocument` is implemented twice (public copy in `transcription/verse-index.ts`, private copy in `repositories/transcriptions.ts`); the repository copy is the one that writes rows. Consolidate when touching this code.

## 9. Environment Notes

- Use `bun` for all JS commands (from `app/` unless noted). Use `uv` for any Python (repo `AGENTS.md`).
- OPFS sync access handles require a dedicated worker; `@vitest/browser` is available for tests needing real OPFS.
- `FileSystemFileHandle.move()` and `showDirectoryPicker()` are Chromium-only; OPFS itself works in Safari 16.4+/Firefox 111+. Feature-detect, never assume.
- Dev server: `bun run dev` (port 3160). Full baseline: `bun run db:generate && bun run db:check && bun run check && bun run test:unit -- --run`.
