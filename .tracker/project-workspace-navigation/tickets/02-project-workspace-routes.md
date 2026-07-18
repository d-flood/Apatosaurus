# 02 — Project workspace routes (expand)

## What to build

The four project-scoped sub-routes of `SPEC.md` and ADR-0001, landed as the *expand* half of an expand–contract: `projects/[id]/transcriptions`, `projects/[id]/collations`, `projects/[id]/settings`, `projects/[id]/backup`, with a shared layout, while the old mega Projects page at `/projects` keeps working untouched (slice 04 contracts it). Demo: navigate to `/projects/{id}/transcriptions` directly, click through all four section tabs, refresh on each, open the same project in two tabs.

This is a mechanical cut-and-paste of section content out of the mega-page — the change is *where code lives and how sections are addressed*, not what they do.

## Where to start

- Source of everything: `app/src/routes/projects/+page.svelte` (~1,800 lines; template from line ~1190). The section blocks under `{#if activeSection === ...}` (from ~line 1587) map one-to-one onto the four new routes; the sidebar (Project Library, Local Storage, etc.) stays behind for slice 04.
- Copy the mega-page's per-section state/handlers with their sections; the `runLoggedStep`/`logProjects` debug-logging pattern moves verbatim.
- Moved-by-import components: `app/src/lib/components/projects/` — `ProjectBackupPanel`, `ProjectCollationSettingsEditor`, `ProjectTranscriptionsEditor`, `ProjectTranscriptionVersionsPanel`, `ProjectTranscriptionRefreshDialog`, `AddProjectTranscriptionFromProjectDialog`, `ProjectUserManagementStub`.
- Project record loading: `getProject`, `getProjectTranscriptionIds` in `app/src/lib/client/collation/project-collation.ts`.
- Redirect-in-load precedent: `app/src/routes/collation/+page.ts`.
- Slice 01's module for fallback targets and `recordLastOpenedProject`.

## Contract

- Shared `app/src/routes/projects/[id]/+layout.svelte`: loads the project record once, renders the project header (name, description, New Transcription / Import IGNTP / New Collation buttons carrying `?projectId={id}`) and the four section tabs **as links** to the sub-routes. Child routes receive the project via layout data — they do not re-fetch it.
- `projects/[id]` (no section) redirects 302 to `projects/[id]/transcriptions`.
- A URL naming a missing/deleted project redirects along slice 01's chain: last-opened → most recently updated → `/projects`. Never render against fallback state.
- Loading any `projects/[id]/*` route calls slice 01's `recordLastOpenedProject(id)`.
- Section content lands **as-is** in this slice: transcriptions still renders `ProjectTranscriptionsEditor` + `ProjectTranscriptionVersionsPanel` (slice 03 re-homes them); collations, settings, backup render what their mega-page tabs render today.
- The mega-page is NOT modified in this slice (temporary duplication is the accepted cost of expand–contract).

## Out of scope

- No edits to `app/src/routes/projects/+page.svelte`, the navbar, or legacy redirects (slices 04, 05).
- No internal changes to any moved component; no repository, store, or sync changes.
- No visual redesign — content moves, styling stays.
- Resist refactoring extracted logic (including the verbose logging); this is cut-and-paste with import fixes.

## Acceptance criteria

- [ ] All four sub-routes render their section with a shared header, are bookmarkable, and survive refresh.
- [ ] `/projects/{id}` redirects to the transcriptions section; a bogus project id redirects along the fallback chain (route-load unit tests, extending the style of `app/src/routes/project-first-navigation.spec.ts`).
- [ ] Visiting a sub-route records the project as last-opened (unit or e2e assertion).
- [ ] Two browser tabs showing two different projects render independently (e2e).
- [ ] Any new `phosphor-svelte/lib/*` import is added to `optimizeDeps.include` in `app/vite.config.ts`.
- [ ] `cd app && bun run check && bun run test:unit -- --run` passes; `bun run test:e2e` passes.

Commands (run from `app/`): `bun run check`, `bun run test:unit -- --run`, `bun run test:e2e`. Success = all exit 0.

## Blocked by

- 01 — last-opened resolution module (fallback chain, `recordLastOpenedProject`).
