# Issue 14: Project-First Navigation

Architecture reference: `../architecture.md` section 3 (decisions 1, 2)

## What to build

Navigation restructure making project ownership visible: `/projects` is the hub. A project view exposes sections or tabs — Transcriptions, Collations, Settings (charter, collation settings, rules), Backup and Sync. Transcription and collation lists always render within their project context; the old top-level library framing goes away, with route redirects preserved so existing links keep working.

## Where to start

- `app/src/routes/projects/+page.svelte` and `app/src/lib/components/projects/*.svelte` — the existing hub and panels (ProjectTranscriptionsEditor, ProjectCollationSettingsEditor, ProjectBackupPanel) become the tab contents.
- `app/src/routes/transcription/(library)/` — the top-level library framing to retire; its remaining useful pieces (list rendering, IGNTP/TEI import entry points) move into project context.
- Deep links: `/transcription/[id]` and `/collation/[id]/[phase]` remain the canonical editor routes; project views link into them.

## Contract

- No view exists in which a transcription or collation appears unowned by a project.
- Old top-level list routes redirect (SvelteKit redirects, not dead links).
- Editor deep-link routes are unchanged.
- Information architecture only: existing DaisyUI components and styling; no visual redesign.
- Creation flows (new transcription, TEI import, IGNTP import) remain reachable and land in an explicit project (defaulting to `Default`).

## Out of scope

- Entity headers and lineage display inside the editors (issue 15).
- Onboarding/first-run content (issue 16).
- Backup-health panel internals (issue 13) — just give it a home in the Backup and Sync section if it exists by then.
- `ProjectUserManagementStub.svelte` — leave as stub or delete; note the choice in TRACKER.md.

## Acceptance criteria

- [ ] `/projects` hub shows projects; a project view exposes Transcriptions / Collations / Settings / Backup and Sync sections.
- [ ] Legacy library route redirects to project context (test the redirect).
- [ ] Editor deep links unchanged (existing route tests still pass).
- [ ] Creation and import flows reachable from project context and assign the chosen project.
- [ ] Full baseline passes.

```bash
cd app
bun run check && bun run test:unit -- --run
```

Success: full suite passes; manual click-through of hub -> project -> each section -> editor and back shows no unowned view.

## Blocked by

None - can start immediately (issue 06 is Completed).
