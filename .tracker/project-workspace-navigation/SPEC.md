# Project-Workspace Navigation and Re-entry Dashboard

## Problem Statement

A recent restructuring made every transcription and collation owned by a project — correct for the data model, but the UI never caught up. The navbar's "Transcriptions" and "Collations" links are hash-links into tabs on a single mega Projects page, and they do nothing when that page is already open. That one page mixes five jobs: onboarding, a storage dashboard, the project library, project administration, and workflow launching — so scholarly work and infrastructure plumbing compete at the same visual altitude, and the plumbing wins. The primary workflows — transcribe, then (often much later) collate — are the deepest things in the app, and a scholar returning after weeks away has no "continue where I left off." Sync status is repeated in six places, project files display as raw UUIDs, and a destructive development-only Reset DB button sits in the production navbar.

## Solution

Reorganize the app around the **open project** (ADR-0001): the project id lives in the URL on project-scoped pages, document pages stay flat and derive their project from ownership, and a remembered **last-opened project** constructs links when no project is in context.

The navbar becomes a two-destination workflow bar: a project switcher plus Transcriptions and Collations links scoped to the open project. The mega Projects page is decomposed into a calm project picker, four project-scoped sub-pages (transcription library, collation library, settings, backup), and an app-wide **Data & Storage page** that becomes the single destination for storage durability, whole-account export, and database repair. The home page becomes the **dashboard**: recent documents to resume, attention items, and creation shortcuts — the re-entry point for a scholar returning after time away.

Delivery is two independently shippable phases: Phase 1 restructures the information architecture; Phase 2 replaces the brochure home page with the dashboard.

## User Stories

### Navigation and the open project

1. As a scholar, I want the navbar's Transcriptions link to take me to a real page listing my open project's transcriptions, so that the navigation does what it says.
2. As a scholar, I want the navbar's Collations link to take me to my open project's collation library, so that I can reach my second core workflow in one click.
3. As a scholar, I want a project switcher visible in the navbar, so that I always know which project I am working in.
4. As a scholar, I want switching projects to keep me in the same section (e.g., collations to collations), so that switching context does not lose my place.
5. As a scholar, I want the URL to identify the project I am viewing on project pages, so that refresh, bookmarks, and multiple tabs behave predictably.
6. As a scholar, I want two browser tabs to show two different projects simultaneously, so that I can compare or work across projects.
7. As a scholar returning after weeks, I want the app to remember my last-opened project, so that navbar links and creation flows target it without me re-selecting it.
8. As a scholar, I want a "Manage projects…" entry in the switcher, so that I can reach the full project picker when I need it.
9. As a scholar with no projects yet, I want navbar links to land me on the project picker, so that I am guided to create one rather than hitting an error.
10. As a scholar following a stale bookmark to a legacy list route, I want to be redirected to my project's corresponding library, so that old links keep working.
11. As a scholar whose URL names a deleted project, I want to be redirected along a sensible fallback chain, so that I never see a page rendered against phantom state.

### Project pages

12. As a transcriber, I want my project's transcription library to show titles, sigla, commit state, and last-updated dates with an Open action, so that my daily worklist is clean and scannable.
13. As a transcriber, I want the transcription library free of collation configuration, so that I am not wading past witness-treatment dropdowns that only matter months later.
14. As a collator, I want witness treatments and hand exclusions on the project Settings page beside regularization rules, so that all "how should collation interpret witnesses" configuration lives in one place.
15. As a collator, I want the cross-project version refresh panel on the Settings page, so that collation-prep concerns are grouped together.
16. As a scholar, I want each project section (transcriptions, collations, settings, backup) to be its own URL, so that I can link and return to a specific section.
17. As a scholar, I want the project header (name, description, creation buttons) shared across all project sections, so that context and actions are always at hand.
18. As a scholar, I want to delete a transcription or collation from an overflow menu on its library row, so that the capability exists without a misclick-prone red button beside Open.
19. As a scholar, I want deletion to ask for confirmation, so that I cannot destroy work with a single click.
20. As a scholar, I want the project picker to show simple cards — name, description, one sync badge, Open — so that choosing a project is calm and quick.
21. As a scholar, I want project creation and zip import together on the picker, so that every way of adding a project lives in one place.

### Creation flows

22. As a transcriber, I want New Transcription and Import IGNTP buttons on the project header to create into that project, so that the destination is unambiguous.
23. As a scholar hitting a creation page without a project in the URL, I want a visible project selector preselected to my last-opened project, so that an hour of typing never lands in a project I did not intend.
24. As a first-time user with no projects, I want document creation to fall back to an automatically created Default project, so that I can start working without ceremony.

### Dashboard (Phase 2)

25. As a returning scholar, I want the home page to show my most recently updated documents with Open buttons, so that resuming work is one click.
26. As a returning scholar, I want each Continue entry to show title, type, project, commit state, and when it was last touched, so that I can pick the right document at a glance.
27. As a collator, I want resuming a collation to land on its current workflow phase, so that I continue where the workflow actually is.
28. As a scholar, I want a Needs Attention section that appears only when something is wrong (backup problems, storage durability, near-quota), so that plumbing interrupts me only when it must.
29. As a scholar, I want each attention item to link to the place where I can fix it, so that warnings are actionable.
30. As a scholar, I want Start Something buttons that name their target project, so that I know where a new document will land before I click.
31. As a first-time user, I want a single welcome card guiding me to create my first project, so that the empty app is not a wall of empty sections.
32. As a user with projects but no documents, I want creation shortcuts promoted to the top of the dashboard, so that the next step is obvious.
33. As a prospective user, I want the feature overview preserved on the About page, so that the pitch still exists without occupying my working home page.

### Data safety and status

34. As a scholar, I want one Data & Storage page holding storage durability, persistent-storage requests, whole-account export, and database repair, so that break-glass tooling has a single home off my daily path.
35. As a scholar, I want the navbar sync badge to be the single status surface and to link to the Data & Storage page, so that status is consistent and actionable.
36. As a scholar, I want per-project backup controls to remain on that project's backup page only, so that there is exactly one place to operate on a project's backup.
37. As a scholar, I want the backup file list to show document titles with file paths as secondary text, so that I can tell which files are which without decoding UUIDs.
38. As a scholar setting up, I want the full storage onboarding guidance on the Data & Storage page, and only a compressed reminder in the dashboard's attention area, so that setup advice does not dominate every visit.
39. As a user of the production app, I want the Reset DB button absent unless the app runs in development mode, so that a destructive developer tool is not one click away.

## Implementation Decisions

- **URL scoping (ADR-0001).** Project-scoped pages carry the project id in the URL: `projects/{id}/transcriptions` (default section), `projects/{id}/collations`, `projects/{id}/settings`, `projects/{id}/backup`. `projects/{id}` redirects to its transcriptions section. Document pages remain flat (`transcription/{id}`, `collation/{id}/{phase}`) and derive their project from ownership; back-links to a library are computed from ownership, never from navigation history.
- **Last-opened project resolution** is a new pure module and the only new seam. Resolution chain: id in localStorage → most recently updated project → project picker. It also constructs the navbar, switcher, redirect, and creation-preselection link targets. Every consumer calls through it; no surface reimplements the chain. The stored id lives in localStorage (same durability class as the theme), never in canonical files or the rebuildable SQLite index.
- **Navbar contract.** Logo → home. Project switcher listing projects, navigating to the same section in the target project (default: transcriptions), with a "Manage projects…" item. Transcriptions and Collations links built from the last-opened project (picker if no projects exist). Right side: existing sync status indicator (unchanged rendering, now wrapped in a link to the Data & Storage page), notifications bell, theme toggle. Removed: About (moves to dashboard footer), Reset DB (rendered only in development mode), all hash-links.
- **Legacy routes.** The bare transcription and collation list routes redirect to the last-opened project's corresponding library. The dead global library page components behind today's redirects are deleted. Old `#section` hash URLs get no special handling — in-app emitters are all removed; stale external bookmarks land on the picker.
- **Section decomposition is a mechanical extraction.** State, loaders, and handlers move to the route that owns them, unchanged — including the existing debug-logging pattern. A shared project layout loads the project record once; child routes receive it. Existing panels and dialogs (backup, collation settings editor, transcriptions editor, versions panel, zip import, index repair report) move by import path only. The transcriptions-editor and versions panels render under Settings; the transcription library section is a pure document list.
- **Recency = `updated_at`.** The dashboard Continue list is the top 5 of transcriptions ∪ collations ordered by existing `updated_at` descending, across all projects. No new recency tracking is written anywhere; opening without editing does not reorder.
- **Creation flows.** Creation pages accept an explicit `projectId` query parameter; when absent they show a visible project selector preselected via the resolution module. The lazy Default-project bootstrap remains untouched as the true-first-run fallback.
- **Deletion.** Both libraries expose Delete in a per-row overflow menu driving the existing confirm dialog and existing repository deletion functions. No new deletion semantics, modal components, or cascade changes.
- **Data & Storage page** (app-wide): storage durability report, persistent-storage request, storage usage, whole-account export, database repair, full onboarding guidance. It shows at most a per-project status list linking to each project's backup page — no duplicated backup controls.
- **Dashboard composition** (Phase 2, in order): Continue (top 5, hidden when empty), Needs Attention (only when non-empty; the sole surface where plumbing interrupts unprompted), Start Something (project name visible on each button), footer with About link and version. Empty states: no projects → single welcome card; projects but no documents → Start Something promoted to top.
- **Phasing.** Phase 1 (IA restructure) ships alone with the brochure home page intact. Phase 2 (dashboard) consumes Phase 1's contracts. Nothing in Phase 1 depends on Phase 2.
- Any new phosphor icon import must be added to the Vite `optimizeDeps.include` list, per project convention.

## Testing Decisions

Good tests here assert external behavior — the URL the user lands on, the rows they see, the project a document is created into — never component internals or store wiring.

- **Playwright e2e (primary seam).** The feature is navigation, so the browser seam carries the load: navbar links land on real pages; the switcher preserves section; legacy routes redirect; creation preselects the last-opened project; delete works through the overflow menu; dashboard Continue opens the correct editor at the correct phase; first-run and empty states render as specified. Prior art: the existing files-as-database and transcription-editor-focus e2e suites.
- **Route-load unit seam.** SvelteKit load functions tested as pure functions asserting redirect status and location, replacing the existing project-first-navigation spec in place: legacy list routes, project-root-to-default-section, and the missing-project fallback chain. The old spec's assertions against `#hash` targets are rewritten, not deleted.
- **Last-opened resolution module.** Unit tests covering the full chain: valid stored id, stale id naming a deleted project, no stored id with projects present, no projects at all.
- **Component seam (sparingly).** Browser-mode component specs only for leaf components with real branching — dashboard sections' empty/populated/attention states. Prior art: existing onboarding-guidance and entity-header component specs.
- **Named test migrations.** Every existing spec that references a restructured route is updated by name in the tickets; "the test referenced a deleted route" is never grounds for deleting the test.

## Out of Scope

- Visual redesign beyond moving content between pages; theme system; notification center.
- Collation workflow phases, IGNTP import internals, sync engine, canonical file formats.
- Any change to deletion, sync, or project-bootstrap semantics beyond what is specified above.
- New recency tracking (open-without-edit does not count as activity).
- Hash-URL redirect shims for the retired `#section` scheme.
- Internal rewrites of the moved panels and dialogs (except the backup file list showing titles instead of UUIDs).
- Refactoring repositories, stores, or the debug-logging pattern encountered during extraction.

## Further Notes

- Vocabulary follows the project glossary: *open project*, *last-opened project*, *project-scoped page*, *document page*, *dashboard*, *Data & Storage page*, *collation settings*, *project transcription library*.
- ADR-0001 records why lists are project-nested while editors are flat; implementers should read it before "fixing" the asymmetry.
- The design decisions herein were locked in a twelve-question grilling session; where this spec is silent, prefer the narrower reading — every fence exists because the adjacent refactor looked helpful.
