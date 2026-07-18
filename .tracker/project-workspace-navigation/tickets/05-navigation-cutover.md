# 05 — Navigation cutover

## What to build

Every entry point starts targeting the new information architecture in one cutover: the navbar becomes the two-destination workflow bar from `SPEC.md`, legacy routes redirect into the workspace, dead pages are deleted, and the cross-cutting navigation e2e suite proves it. Demo: from anywhere in the app, every navbar interaction and stale URL lands on a real page in the new IA.

## Where to start

- Navbar: `app/src/lib/components/Navbar.svelte` — currently emits `/projects#transcriptions`-style hash links in both the desktop menu and the mobile dropdown, hosts the Reset DB button (`resetDevelopmentDb`) and About link.
- Link targets and switcher navigation come from slice 01's builders — do not re-derive the chain here.
- Legacy redirects: `app/src/routes/transcription/(library)/+page.ts`, `app/src/routes/transcription/(library)/igntp/+page.ts` (no-project branch), `app/src/routes/collation/+page.ts` — all currently redirect to `/projects#...` targets.
- Dead code to delete: the page components behind those redirects — the old global library `app/src/routes/transcription/(library)/+page.svelte` and the old collation list `app/src/routes/collation/+page.svelte` (keep each route's `+page.ts` as the redirect).
- Route-load spec to rewrite in place: `app/src/routes/project-first-navigation.spec.ts`.
- Sync badge: `app/src/lib/components/SyncStatusIndicator.svelte` — rendering unchanged, wrapped in a link by the navbar.
- E2E prior art: `app/e2e/files-as-database.spec.ts`, `app/e2e/transcription-editor-focus.spec.ts`.

## Contract

- Navbar, left to right: logo → `/`; project switcher (lists projects; navigates to the same section in the target project when on a project-scoped page, else to the target's transcriptions; "Manage projects…" item → `/projects`); Transcriptions and Collations links via slice 01 (→ `/projects` when no projects exist); sync badge linking to `/data`; notifications bell; theme toggle. The mobile dropdown mirrors the same targets.
- Removed from the navbar: About (the `/about` route survives, reachable by URL until slice 08 adds the footer link) and all hash links.
- Reset DB renders only when `import.meta.env.DEV` is true.
- Bare `/transcription` → last-opened project's transcriptions; bare `/collation` → last-opened project's collations; both via slice 01's chain (`/projects` when no projects). The IGNTP route's no-project redirect gets the same new target.
- From an open editor, navbar links target the *last-opened* project, not the open document's project — URL rules only, no cleverness.
- No hash-sniffing shims: stale `#section` bookmarks land on the picker unassisted.

## Out of scope

- `SyncStatusIndicator` internals, notification center, theme system.
- Deletion semantics (the deleted library page's delete button was superseded by slice 03).
- The home page and About content (slice 08).

## Acceptance criteria

- [ ] E2E: navbar Transcriptions/Collations land on the open project's libraries from the picker, from a project page, and from an open editor (last-opened project in the editor case); switcher on `projects/a/collations` → project B lands on `projects/b/collations`; "Manage projects…" lands on `/projects`; sync badge lands on `/data`; with zero projects, both links land on `/projects`.
- [ ] E2E: bare `/transcription` and `/collation` redirect to the last-opened project's libraries.
- [ ] `app/src/routes/project-first-navigation.spec.ts` rewritten in place: same seam, new targets, plus the no-projects fallback — old `#hash` assertions retargeted, not deleted.
- [ ] The old global library and collation list page components no longer exist; `grep -rn "projects#" app/src` returns nothing.
- [ ] Reset DB button absent when built for production (assert the dev-flag gate).
- [ ] `cd app && bun run check && bun run test:unit -- --run && bun run test:e2e` passes.

Commands (run from `app/`): `bun run check`, `bun run test:unit -- --run`, `bun run test:e2e`, plus the grep above. Success = all exit 0, grep empty.

## Blocked by

- 01 — resolution module (all link targets).
- 02 — project workspace routes (link destinations exist).
- 04 — picker + Data & Storage page (`/data` exists for the sync badge; picker exists for "Manage projects…").
