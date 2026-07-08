# Ticket 10: Folder Import and Unified Ingestion

Architecture reference: `../architecture.md` sections 3 (decision 7), 8

## What to build

On Chromium, a user can pick a local directory containing a project folder and import it through the same staged-ingestion pipeline ticket 09 built for zips. `project-restore.ts` is refactored onto the store so that zip import, folder import, and sync-pull share one validated ingestion path — no parallel restore implementations remain.

When the picked folder is a project folder from another machine with the **same project id** but unknown revisions, that is the sync case — direct the user to connect it as a sync target (ticket 07 flow) instead of importing. A **different project id** is the import case and proceeds through ingestion.

## Where to start

- The staged-ingestion entry point from ticket 09 (built to accept a readable file tree).
- `app/src/lib/client/sync/project-restore.ts` — `importCloudProject()` and `pullLinkedProjectUpdates()`; this ticket retires their bespoke ingestion in favor of the shared path.
- `app/src/lib/client/sync/providers/local-folder-provider.ts` and `local-folder-handles.ts` — reading a picked directory.
- `app/src/lib/client/sync/sync-manager.ts` — the Ticket 07 pull path; its post-pull validation should end up calling the same ingestion primitive.

## Contract

- One ingestion path: zip, folder, and sync-pull all validate through migrate-on-read in staging before any live write. Behavior differences (per-file mirror vs whole-project import) live above the primitive, not beside it.
- Same-id-unknown-revisions detection produces a distinct user-facing outcome (pointer to sync connect), not a silent import or overwrite.
- Collision handling, path hygiene, and reporting follow the ticket 09 contract unchanged.
- Folder import is feature-gated on `showDirectoryPicker` support; non-Chromium sees the zip path.

## Out of scope

- New sync semantics or scheduling changes (ticket 07 owns those).
- Copy-with-lineage flows (ticket 11).
- Onboarding/capability messaging beyond the feature gate (tickets 12, 16).

## Acceptance criteria

- [ ] Importing a valid project directory (mock/fake file-system-access in tests) restores the project identically to importing its zip.
- [ ] `project-restore.ts`'s old bespoke ingestion is gone; sync-pull, zip, and folder ingestion resolve to one shared code path (assert by test or by the absence of the old exports).
- [ ] Same-project-id folder is detected and routed to the sync-connect suggestion, not imported.
- [ ] Corrupt-file and traversal behavior matches ticket 09 (shared tests exercise the folder source).
- [ ] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/client/sync src/lib/client/store
bun run check && bun run test:unit -- --run
```

Success: focused suites pass with folder-source ingestion tests; no references to the retired restore internals remain (`grep -r importCloudProject app/src` returns only the new path or nothing).

## Blocked by

- 07 (`07-local-folder-sync.md`) — sync-pull path must exist to be unified.
- 09 (`09-zip-import-staged-ingestion.md`) — the ingestion primitive.
