# 01 — Prefactor: last-opened project resolution module

## What to build

A pure module owning the *last-opened project* contract from `SPEC.md` (see also `docs/adr/0001-url-scoped-project-navigation.md`): remember which project the scholar last opened, resolve it through a fallback chain, and build every navigation link target that depends on it. This is the epic's one new seam — every later slice (navbar links, switcher, legacy redirects, creation preselection, dashboard buttons) calls through it instead of reimplementing the chain. Verifiable by unit tests alone; no UI in this slice.

## Where to start

- Create the module under `app/src/lib/client/` (suggested: `app/src/lib/client/navigation/last-opened-project.ts`).
- Project listing shape: `listProjects` and `ProjectOption` in `app/src/lib/client/collation/project-collation.ts` — options carry `id` and the record carries `updatedAt` (see `app/src/lib/client/db/repositories/projects.ts` for what's queryable).
- localStorage usage precedent: the theme toggle in `app/src/lib/components/Navbar.svelte` (`localStorage.getItem('theme')`), guarded by `browser` from `$app/environment`.
- Unit test prior art: `app/src/routes/project-first-navigation.spec.ts` (plain vitest, no browser).

## Contract

- Storage: a single localStorage key holding the last-opened project id. Same durability class as the theme — never written to canonical files or the SQLite index, so folder sync and Repair Database never touch it.
- Resolution is a pure function of `(storedId: string | null, projects: {id, updatedAt}[])`:
  1. `storedId` if it names a project in the list;
  2. else the project with the most recent `updatedAt`;
  3. else `null` (callers route to `/projects`).
  No I/O inside the decision logic; localStorage read/write lives in thin wrappers around it.
- Link builders exported for later slices, all resolution-backed:
  - navbar targets: `/projects/{id}/transcriptions`, `/projects/{id}/collations`, falling back to `/projects` when resolution yields `null`;
  - switcher target: same section in another project, given `(currentSection, targetProjectId)` where section ∈ `transcriptions | collations | settings | backup`;
  - legacy redirect targets for bare `/transcription` and `/collation`.
- A `recordLastOpenedProject(id)` entry point that slice 02's layout will call.

## Out of scope

- No UI, no route files, no navbar changes.
- Do not touch `ensureDefaultProject` (`app/src/lib/client/db/client.ts`), repositories, or stores.
- Do not wire any existing page to the module yet — consumers arrive in later slices.

## Acceptance criteria

- [ ] Unit tests cover: valid stored id; stale id naming a deleted project; no stored id with projects present; no projects at all; same-section link construction for all four sections.
- [ ] Resolution logic is importable and testable without a browser environment (no top-level `window`/`localStorage` access).
- [ ] `cd app && bun run test:unit -- --run` passes.
- [ ] `cd app && bun run check` passes.

Commands (run from `app/`): `bun run test:unit -- --run`, `bun run check`. Success = both exit 0 with the new spec included in the run.

## Blocked by

None - can start immediately.
