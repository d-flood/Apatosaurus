# Issue 16: Onboarding and About Content

Architecture reference: `../architecture.md` section 3 (decision 8)

## What to build

First-run and docs/about content that makes the recommended setup and the ownership model legible:

1. First-run guidance: recommended setup is a Chromium-based browser, install the PWA, allow persistent storage, connect a sync folder — optionally inside a Dropbox/OneDrive/Drive-managed directory (the Obsidian/Zotero pattern). Firefox/Safari are supported with zip export/import as the backup path.
2. About/docs page content stating where files live and how to leave the app with your data (sync folder or zip; every transcription and collation has a TEI sibling).
3. All capability-dependent messaging flows through issue 12's `capabilities.ts` — one source of truth for what this browser supports; remove any remaining scattered notices (including the Phase 1 capability notice).

## Where to start

- `capabilities.ts` from issue 12 — the conditions that select which guidance renders.
- Grep for the existing non-Chromium capability notice from issue 01 and any offline/about routes (`app/src/routes/offline/`, existing about content) — consolidate rather than add a second copy.
- The `/projects` hub (issue 14) — the natural first-run surface when no projects beyond the empty `Default` exist.

## Contract

- One content source per message, selected by capability state; no browser-sniffing strings duplicated across components.
- First-run guidance is skippable and does not gate any functionality.
- Content states the data-ownership facts accurately per `../architecture.md` (files in OPFS, sync mirror byte-identical minus local-only files, TEI siblings regenerated on commit).

## Out of scope

- README and contributor documentation (issue 23).
- The persistence warning banner and install nudge mechanics (issues 12-13) — this issue is content and first-run flow, not those triggers.

## Acceptance criteria

- [ ] First-run experience renders capability-appropriate guidance (Chromium full path vs Firefox/Safari export path) — tested by driving `capabilities.ts` state in component tests.
- [ ] About/data-ownership content exists and is reachable from the app.
- [ ] No remaining ad-hoc capability notices outside the consolidated path (grep-verifiable).
- [ ] Full baseline passes.

```bash
cd app
bun run check && bun run test:unit -- --run
```

Success: full suite passes; manual first-run walkthrough on Chromium and Firefox shows the correct respective guidance.

## Blocked by

- 12 (`12-capabilities-and-persistence.md`)
- 14 (`14-project-first-navigation.md`)
