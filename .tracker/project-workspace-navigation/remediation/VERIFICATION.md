# project-workspace-navigation — Verification

- HEAD: `a856fe9`
- Date: 2026-07-19

## Results summary

| # | Command | Result |
|---|---------|--------|
| 1 | `bun run check` (app/) | PASS |
| 2 | `bun run test:unit -- --run` (app/) | PASS |
| 3 | `bun run test:e2e` (app/) | FAIL (2 tests) |
| 4 | `grep -rn "activeSection" app/src/routes/projects` | PASS (no matches) |
| 5 | `grep -rn "projects#" app/src` | PASS (no matches) |
| 6 | `grep -rn "currentProject" app/src` | PASS (no matches) |

Overall: FAIL — `bun run test:e2e` reports 2 failing tests.

## 1. `bun run check` — PASS

Last output lines:

```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json
1784488062461 START "/home/dflood/repos/Apatosaurus/app"
1784488062477 COMPLETED 5604 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

Exit code 0. 0 errors, 0 warnings.

## 2. `bun run test:unit -- --run` — PASS

Last output lines:

```
 ✓ |client (chromium)| src/lib/components/Dashboard.svelte.spec.ts (4 tests) 20ms
 ✓ |client (chromium)| src/lib/components/OnboardingGuidance.svelte.spec.ts (3 tests) 11ms
 ✓ |client (chromium)| src/lib/components/EntityHeader.svelte.spec.ts (3 tests) 9ms
 ✓ |client (chromium)| src/lib/components/TranscriptionLineage.svelte.spec.ts (3 tests) 10ms

 Test Files  88 passed (88)
      Tests  545 passed (545)
   Start at  14:07:48
   Duration  25.04s
```

88 test files passed, 545 tests passed. (stderr contains benign `[document-store] Falling back to transcription index cache` / OPFS-unavailable messages from passing tests.)

## 3. `bun run test:e2e` — FAIL

31 tests: 28 passed, 2 failed, 1 skipped. Script exited with code 1.

Both failures are in `e2e/files-as-database.spec.ts` (not in the project-workspace-navigation or navigation-cutover specs, which passed). Failure is identical for both: the "Verse Selector" verse button `/Rom 15:.*2 witness sources/` is never rendered/visible.

Last output lines:

```
  2 failed
    e2e/files-as-database.spec.ts:24:1 › fresh user creates, commits, collates, and exports a project
    e2e/files-as-database.spec.ts:42:1 › disaster recovery restores an equivalent project after site data is wiped
  1 skipped
  28 passed (3.0m)
error: script "test:e2e" exited with code 1
```

### Full failing output

```
  1) e2e/files-as-database.spec.ts:24:1 › fresh user creates, commits, collates, and exports a project

    Error: expect(locator).toBeVisible() failed

    Locator: locator('section').filter({ has: getByRole('heading', { name: 'Verse Selector' }) }).getByRole('button', { name: /Rom 15:.*2 witness sources/ }).first()
    Expected: visible
    Timeout: 5000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" with timeout 5000ms
      - waiting for locator('section').filter({ has: getByRole('heading', { name: 'Verse Selector' }) }).getByRole('button', { name: /Rom 15:.*2 witness sources/ }).first()

      378 | 		})
      379 | 		.first();
    > 380 | 	await expect(verseButton).toBeVisible();
          | 	                          ^
      381 | 	await verseButton.click();
      382 | 	await expect(page.getByText('Loading witnesses...')).not.toBeVisible({ timeout: 30_000 });
      383 | 	await expect(page.locator('tbody tr')).toHaveCount(2, { timeout: 30_000 });
        at createAndCommitCollation (/home/dflood/repos/Apatosaurus/app/e2e/files-as-database.spec.ts:380:28)
        at createCompleteProjectAndExport (/home/dflood/repos/Apatosaurus/app/e2e/files-as-database.spec.ts:281:2)
        at /home/dflood/repos/Apatosaurus/app/e2e/files-as-database.spec.ts:25:22

    Error Context: test-results/files-as-database-fresh-us-8c264-lates-and-exports-a-project/error-context.md

  2) e2e/files-as-database.spec.ts:42:1 › disaster recovery restores an equivalent project after site data is wiped

    Error: expect(locator).toBeVisible() failed

    Locator: locator('section').filter({ has: getByRole('heading', { name: 'Verse Selector' }) }).getByRole('button', { name: /Rom 15:.*2 witness sources/ }).first()
    Expected: visible
    Timeout: 5000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" with timeout 5000ms
      - waiting for locator('section').filter({ has: getByRole('heading', { name: 'Verse Selector' }) }).getByRole('button', { name: /Rom 15:.*2 witness sources/ }).first()

      378 | 		})
      379 | 		.first();
    > 380 | 	await expect(verseButton).toBeVisible();
          | 	                          ^
      381 | 	await verseButton.click();
      382 | 	await expect(page.getByText('Loading witnesses...')).not.toBeVisible({ timeout: 30_000 });
      383 | 	await expect(page.locator('tbody tr')).toHaveCount(2, { timeout: 30_000 });
        at createAndCommitCollation (/home/dflood/repos/Apatosaurus/app/e2e/files-as-database.spec.ts:380:28)
        at createCompleteProjectAndExport (/home/dflood/repos/Apatosaurus/app/e2e/files-as-database.spec.ts:281:2)
        at /home/dflood/repos/Apatosaurus/app/e2e/files-as-database.spec.ts:46:22

    Error Context: test-results/files-as-database-disaster-0dbae-ct-after-site-data-is-wiped/error-context.md
```

### Passing epic-relevant e2e tests (for reference)

```
  ✓  11 e2e/navigation-cutover.spec.ts:5:1 › navbar falls back to the picker and hides development tools in production
  ✓  12 e2e/navigation-cutover.spec.ts:22:1 › navbar follows the last-opened project and the switcher preserves the workspace section
  ✓  13 e2e/navigation-cutover.spec.ts:72:1 › mobile navigation mirrors project targets
  ✓  14 e2e/navigation-cutover.spec.ts:96:1 › legacy document list URLs redirect into the last-opened project
  ✓  17 e2e/project-workspace-navigation.spec.ts:5:1 › project libraries are clean worklists and collation configuration lives in settings
  ✓  18 e2e/project-workspace-navigation.spec.ts:77:1 › project workspace sections are bookmarkable and stay isolated across tabs
```
