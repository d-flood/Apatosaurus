# Issue 13: Backup-Health Panel and Install Nudge

Architecture reference: `../architecture.md` sections 3 (decision 8), 9 (invariant 8)

## What to build

1. **Backup-health panel**: per project, show last committed, last synced (if a folder is connected), and last exported. A project with commits but no sync target and no recent export shows an actionable "your data exists only in this browser" prompt linking to connect-folder (Chromium) or export (everywhere). This absorbs and replaces the logic in `backup-health.ts` / `backup-status.ts`.
2. **PWA install nudge**: a considered, dismissible install prompt shown once a user has real data (installed PWAs get persistence and better permission retention on Chromium). Uses install state from issue 12's `capabilities.ts`.

## Where to start

- `app/src/lib/client/sync/backup-health.ts` and `backup-status.ts` — existing logic to absorb; keep their tests' intent.
- `app/src/lib/components/projects/ProjectBackupPanel.svelte` — the Folder Sync UI from issue 07; the health panel extends or sits beside it.
- Last-synced comes from issue 07's fingerprint/sync state; last exported from wherever issue 08 recorded it (check TRACKER notes); last committed from checkpoint listings.
- `capabilities.ts` (issue 12) for install state and `beforeinstallprompt` handling.

## Contract

- Health states are computed by a pure, tested function from (commit recency, sync target presence + last sync, last export); components render its output.
- "Data exists only in this browser" requires: ≥1 commit ∧ no enabled sync target ∧ no export on record.
- The install nudge appears at most once per data milestone, is dismissible, and never appears when already installed or unsupported.
- No new persistence of health data beyond the timestamps already recorded; nothing irreplaceable in the index.

## Out of scope

- Persistence banner and storage estimate (issue 12).
- Navigation placement changes (issue 14) — build the panel where `ProjectBackupPanel` lives today; issue 14/15 may re-home it.
- Onboarding content (issue 16).

## Acceptance criteria

- [x] Health-state function tested across the matrix (fresh project, committed+synced, committed+exported-only, committed+unprotected).
- [x] Unprotected projects render the actionable prompt with the capability-correct action (folder vs export).
- [x] `backup-health.ts`/`backup-status.ts` logic is absorbed; stale duplicates deleted.
- [x] Install nudge conditions unit-tested (has data, not installed, supported, not recently dismissed).
- [x] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/client/sync
bun run check && bun run test:unit -- --run
```

Success: full suite passes; old backup-status duplication gone.

## Blocked by

- 08 (`08-zip-export.md`) — last-exported needs export to exist.
- 12 (`12-capabilities-and-persistence.md`) — install/capability state.

## Implementation Blocker

- 2026-07-07: Implementation stopped before code changes because the contract expects last-exported to come from timestamp data recorded by issue 08, and also says not to add health persistence beyond already-recorded timestamps. The current code only keeps `exportedAt` in live component state after `exportProjectZip()` / `exportAllProjectsZip()` returns; no persisted per-project or account export timestamp exists in the store or app settings. Needs a human decision before implementation: add export timestamp persistence, relax the health contract, or split that prerequisite into a separate issue.
- 2026-07-07: Human validation resolved this blocker by approving option 1: issue 13 may persist last-export timestamps in app-local settings/store data as rebuildable health metadata, not irreplaceable user data.
