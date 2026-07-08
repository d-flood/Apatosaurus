# Ticket 22: End-to-End Scenarios and CI

Architecture reference: `../architecture.md` section 9

## What to build

Playwright scenarios proving the architecture end-to-end, wired into CI:

1. **Fresh user**: create project -> transcribe -> commit -> collate -> commit -> export zip.
2. **Disaster recovery**: wipe site data -> import zip -> verify equivalence.
3. **Committee**: two browser contexts sharing a mock/local folder -> update propagation -> divergent-commit conflict copies on both sides.
4. **Upgrade**: fixture store at synthetic older document versions -> app opens, migrate-on-read upgrades on save, index rebuilds on version bump.

CI runs the unit suites (node + browser) and the Playwright suite.

## Where to start

- Playwright is already configured (see `app/` config and `../current-state.md` section 1); check for existing specs to follow as prior art.
- `.github/workflows/app-pages.yml` — the existing workflow; extend or add a test workflow beside it.
- The committee scenario can drive the mock provider or a shared OPFS-backed fake; reuse `fake-file-system-access.spec-support.ts` patterns from the sync tests.
- Upgrade fixtures: the migrate-on-read registry's fixture convention from ticket 02 (`app/src/lib/client/store/__fixtures__/`).

## Contract

- Scenarios drive the real app through the UI (routes, buttons), not internal APIs — they are the proof the vertical slices integrate.
- The upgrade scenario requires at least one synthetic v2 format with an upgrader, exercising the registry for real; mark it clearly as synthetic/test-only.
- CI failure on any scenario blocks merge (whatever branch protection the repo uses; at minimum the workflow reports failure).

## Out of scope

- New invariant unit tests (ticket 21).
- Documentation (ticket 23).
- Cross-browser Playwright matrix beyond Chromium if the harness cannot support it — document what runs where.

## Acceptance criteria

- [ ] All four scenarios implemented and passing locally via `bunx playwright test`.
- [ ] CI workflow runs unit + Playwright suites on push/PR and passes.
- [ ] Full baseline passes.

```bash
cd app
bun run db:generate && bun run db:check
bun run check
bun run test:unit -- --run
bunx playwright test
```

Success: all commands pass locally and in CI.

## Blocked by

- 21 (`21-invariant-test-suite.md`) — scenarios build on the invariant fixtures and a stabilized feature set.
