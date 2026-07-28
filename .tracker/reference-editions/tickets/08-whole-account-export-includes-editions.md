# 08 — Whole-account export includes reference editions

## What to build

Extend the whole-account export on the Data & Storage page so that a scholar's user-supplied reference editions are part of their backup, and restore correctly on a new machine.

Without this, a scholar who has added several editions loses them on any storage reset or machine change — while every other piece of their data survives. That contradicts the app's data-ownership promise.

Demo: add a user-supplied edition, run the whole-account export, clear storage, restore from the archive, and seed from that edition again.

## Where to start

- `app/src/routes/data/+page.svelte` — the Data & Storage page. `exportAllProjectArchives` (~line 208) calls `exportAllProjectsZip`.
- The `exportAllProjectsZip` implementation and its import counterpart. Note it currently walks **projects**; reference editions live outside any project.
- `app/src/lib/client/store/layout.ts` — `appFolder()` (line 172) and the app-level paths beside it.
- The edition storage and catalog registration from ticket 06.
- `CONTEXT.md` defines the **Data & Storage page** as the app-wide surface for storage durability and whole-account export. This is that surface; per-project backup controls live on the project's own backup page and are not touched here.
- Architecture: `.tracker/files-as-database/architecture.md`, section 4.

## Contract

**Whole-account export includes user-supplied reference editions. Per-project archives still exclude them.** Both halves matter. The exclusion from project archives is a deliberate licensing decision from ticket 06 — project archives get handed to colleagues, and an edition inside one silently redistributes it. Do not "unify" the two export paths by making project archives carry editions.

**Bundled editions are never exported.** They ship with the app and would be restored by installing it.

**Restore is idempotent.** Importing an archive twice does not duplicate editions, and the identity rule from ticket 06 is what decides sameness.

**A restore that encounters an edition already present does not overwrite it**, and does not fail the whole restore.

**Export of an account with no user-supplied editions produces an archive equivalent to today's**, so existing archives and existing behavior are unaffected.

**This is backup code.** It is the code least tolerant of breakage in the whole application, and the reason this is its own ticket rather than a line item in ticket 06. A failure mode here is silent data loss discovered months later. Test the restore path, not just the export path.

## Out of scope

- Any change to per-project zip export or import.
- Changing the archive format version or layout for project data.
- Migrating existing archives.
- Editing, versioning, or deduplicating edition *content* — identity is the rule from ticket 06 and does not change here.
- Sync-folder replication of editions. Export/import only.
- Adding UI beyond what the existing whole-account export control needs.

## Acceptance criteria

- [ ] Spec: a whole-account export of an account with two user-supplied editions contains both.
- [ ] Spec: the export contains no bundled editions.
- [ ] Spec: a per-project archive from the same account still contains no editions.
- [ ] Spec: restoring the archive into empty storage makes both editions available in the catalog and seedable.
- [ ] Spec: restoring the same archive twice yields two editions, not four.
- [ ] Spec: restoring an archive whose edition already exists locally leaves the local copy in place and completes without error.
- [ ] Spec: whole-account export of an account with no user-supplied editions produces an archive matching today's output.
- [ ] E2E: the Data & Storage export control still completes successfully.

Commands:

```sh
cd app && pnpm run check && pnpm run test:unit -- --run && pnpm run test:e2e
```

Success = all exit 0.

## Blocked by

- 06 — user-supplied edition storage, the catalog's `user` branch, and the edition identity rule.
