# 06 — Creation-page project selector

## What to build

Creation pages always show their destination project. With `?projectId=` in the URL they behave as today; without it, a visible project selector appears, preselected to the last-opened project via slice 01 — so an hour of typing never silently lands in the wrong project. Demo: open `/transcription/new` bare with three projects → selector shows the last-opened project; create → document appears in that project's library.

## Where to start

- Creation pages: `app/src/routes/transcription/new/+page.svelte` (+ `+page.ts`), `app/src/routes/collation/new/+page.svelte` (project handling in `app/src/routes/collation/new/new-collation-project.ts`, which already calls `ensureDefaultProject`), and the IGNTP import page under `app/src/routes/transcription/(library)/igntp/` (its `+page.ts` already passes through an explicit `projectId`).
- Slice 01's resolution for the preselection; `listProjects` from `app/src/lib/client/collation/project-collation.ts` for the selector options.
- Note: slice 05 changes the IGNTP no-project *redirect*; this slice governs pages that render. If 05 has not landed yet, leave redirect behavior alone — the two slices are independent.

## Contract

- `?projectId=` present → no selector prompt needed; the destination project is displayed (current behavior preserved).
- `?projectId=` absent → visible selector, preselected via slice 01's chain; the created document lands in whatever the selector says at submit time.
- Zero projects → the existing lazy Default-project path runs untouched: `ensureDefaultProject` and its callers are not modified.

## Out of scope

- Creation logic, document formats, bootstrap semantics — this is a destination selector feeding the existing `projectId` path.
- Redirect targets of legacy routes (slice 05).

## Acceptance criteria

- [ ] E2E: bare creation URL with multiple projects shows the selector preselected to the last-opened project; created document appears in that project's transcriptions library; switching the selector before submit lands the document in the switched project.
- [ ] E2E or unit: first run with zero projects still creates into Default.
- [ ] `git diff` touches neither `ensureDefaultProject` nor `app/src/lib/client/db/repositories/project-bootstrap.ts`.
- [ ] `cd app && bun run check && bun run test:unit -- --run && bun run test:e2e` passes.

Commands (run from `app/`): `bun run check`, `bun run test:unit -- --run`, `bun run test:e2e`. Success = all exit 0.

## Blocked by

- 01 — resolution module (preselection).
