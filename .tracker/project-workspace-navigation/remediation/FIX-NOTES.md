# Fix Notes: dashboard.spec.ts write-then-navigate race

## Decision

Agreed with DIAGNOSIS.md. Implemented the minimal recommended fix exactly:

1. **`app/src/lib/client/collation/collation-state.svelte.ts` — `setPhase`**: added
   `markUnsaved();` after `advanceFurthest(normalized);` so a phase transition marks
   the workspace dirty (matching the already-correct `nextPhase`).
2. **`app/src/lib/components/collation/SetupPhase.svelte` — Proceed-to-Alignment
   handler**: added `await collationState.flushPendingSave();` after
   `setPhase('alignment')` and before `goto(...)`, so `phase:'alignment'` is durably
   persisted before any navigation/worker teardown.

### Symptom 2 (test-side, per DIAGNOSIS.md §c "Optional hardening")

The app create path is already correct (`createProjectRecord` write is awaited before
navigate). Tightened the `createProject` helper in `e2e/dashboard.spec.ts`:
- Added a retrying `await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/)`
  before the synchronous `page.url()` snapshot, so the URL read only happens after
  navigation completes.
- Disambiguated the heading matcher to `{ level: 1, name }` (the transcriptions
  layout's `<h1>`) so it no longer also matches the picker card's `<h3>` on `/projects`.

No canonical file formats, sync-engine semantics, or `ensureDefaultProject` touched.
No new dependencies. No new imports.

## Verification results (all from `app/`)

- `bun run check`: PASS (0 errors, 0 warnings).
- `bun run test:unit -- --run`: PASS (88 files, 545 tests).

### `bun run test:e2e -- dashboard.spec.ts` x5 (consecutive, foreground)

| Run | Result |
|----:|--------|
| 1 | 3 passed (40.0s) |
| 2 | 3 passed (39.7s) |
| 3 | 3 passed (39.7s) |
| 4 | 3 passed (39.7s) |
| 5 | 3 passed (39.9s) |

All 5 consecutive runs passed. Test 1 (Continue/phase, the previously-flaky one)
passed every run (~6.8s each, well under the failing-run signature of 16.8s).

### Full `bun run test:e2e`

PASS: 30 passed, 1 skipped (`transcription-list-performance.spec.ts:15` is a
pre-existing `test.skip`, not introduced by this change). Duration 3.0m.

## Files changed (committed, app/ only)

- `app/src/lib/client/collation/collation-state.svelte.ts` (setPhase +markUnsaved)
- `app/src/lib/components/collation/SetupPhase.svelte` (Proceed handler +flushPendingSave)
- `app/e2e/dashboard.spec.ts` (createProject helper: retrying toHaveURL + level:1 heading)
