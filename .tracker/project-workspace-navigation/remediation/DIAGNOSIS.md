# Diagnosis: dashboard.spec.ts write-then-navigate race

Scope: `app/e2e/dashboard.spec.ts`, test 1 ("Continue resumes a collation at its
current phase…"). Investigated the collation phase-resolution path and the
post-create navigation path. Reproduced the primary symptom.

Author note: I was told not to modify app source. No app source was changed; the
only edits in the tree are the pre-existing `.tracker/*` changes listed by
`git status`. This document is the deliverable.

---

## TL;DR

- **Symptom 1 (stale phase) — REPRODUCED (1 of 4 completed runs).** Root cause is a
  **write-durability bug in app source**, not a test flake: advancing a collation
  to `alignment` mutates only in-memory state and is never persisted at transition
  time. It relies on a later 800 ms debounced autosave. When the test's
  `page.goto('/')` (a full document load) tears down the page and its SQLite worker
  before that debounced write flushes, the persisted collation document still says
  `phase: 'setup'`, so re-opening via the bare `/collation/{id}` route resolves to
  `setup`.
- **Symptom 2 (post-create navigation) — NOT reproduced in these runs.** Static
  analysis shows it is a **different** root cause: a test-selector ambiguity
  (`getByRole('heading', {name})` matches the project card on `/projects`) combined
  with a non-retrying `page.url()` snapshot, aggravated by the picker's
  `subscribeLocalDbInvalidations` re-render. The create write is correctly awaited.
- **The two symptoms do NOT share a root cause.** They share only a family
  ("SvelteKit navigation racing the local-db async layer"). Evidence below.

---

## (a) Root cause — precise event ordering

### Symptom 1: Continue resolves to `setup` instead of `alignment`

Design intent (ticket 08): the dashboard "Open" link points at the **bare**
`/collation/{id}` route, and that route "resolves the current workflow phase". The
resolver is:

- `app/src/routes/collation/[id]/+page.svelte` → `onMount` runs
  `goto('/collation/${params.id}/${collationState.phase}', {replaceState:true})`.
- Its parent `app/src/routes/collation/[id]/+layout.svelte` → `onMount` gates the
  child on `isBootstrapping`. When `collationState.collationId !== params.id` it
  calls `collationState.reset()` then `await collationState.loadCollationById(id)`,
  which populates `phase`/`furthestPhase` **from the persisted collation document**.

So on a fresh page load the resolved phase equals whatever was **persisted**. The
bug is that `alignment` is never persisted at the moment of transition.

Ordering of events that produces the failure:

1. `createRomansCollation()` clicks **Proceed to Alignment**
   (`app/src/lib/components/collation/SetupPhase.svelte:890-910`). The handler:
   1. `targetId = await collationState.createNewCollation(...)`
      (`collation-state.svelte.ts:2778`). `createNewCollation` does
      `collationId = id; await persistDocument();` — **and this persist happens
      while `phase` is still `'setup'`.** `persistDocument`
      (`collation-state.svelte.ts:318-341`) writes the workspace artifact with
      `phase: 'setup'` and `updateCollationMetadata({ status: 'setup' })`.
   2. `collationState.setPhase('alignment')`
      (`collation-state.svelte.ts:413-417`). **`setPhase` mutates `phase` and
      `furthestPhase` in memory only — it does NOT call `markUnsaved()` /
      `scheduleSave()` and does not await any persist.**
   3. `await goto('/collation/[id]/alignment', {replaceState:true})` — client-side
      navigation only.
2. The `[phase]` route mounts (`collation/[id]/[phase]/+page.svelte`). Its
   `$effect` calls `setPhase('alignment')` again (still no persist). The
   `AlignmentPhase` auto-runs collation and calls `setAlignmentSnapshot`
   (`collation-state.svelte.ts:1270-1278`), which finally calls `markUnsaved()` →
   `scheduleSave()`. **This is the only path that would persist
   `phase:'alignment'`, and it is an 800 ms debounce** (`scheduleSave`,
   `collation-state.svelte.ts:369-375`) followed by an async worker write.
3. The test asserts the URL is `/alignment` and returns, then immediately runs
   **`await page.goto('/')`** (dashboard.spec.ts:12). `page.goto` is a **full
   browser navigation**: it destroys the document, the module-singleton
   `collationState`, and the dedicated **SQLite `db.worker`**. Any not-yet-fired
   debounced save or in-flight worker write is lost.
4. Test clicks the dashboard **Open** link → SPA navigation to bare
   `/collation/{id}` (href built in `app/src/routes/+page.svelte:131`,
   `href: '/collation/${row.id}'`).
5. Fresh `collationState` has `collationId === null`, so
   `[id]/+layout.svelte` runs `reset()` + `loadCollationById(id)`.
   `loadCollation` reads the persisted document, whose `phase` is still `'setup'`
   and `furthestPhase` still `'setup'` (step 1.i was the last durable write).
6. `[id]/+page.svelte` navigates to `/collation/{id}/setup`. (Even had it targeted
   `/alignment`, the `[phase]` guard at
   `collation/[id]/[phase]/+page.svelte:28-31` would bounce it to
   `furthestPhase === 'setup'` because `canNavigateTo('alignment')` is false.)
   Result: URL settles on `.../setup`. Test fails.

**One-line root cause:** phase advancement (`setPhase`) is applied to in-memory
state and the URL but is never durably written; its only persistence is a fire-and-
forget 800 ms debounced autosave that the subsequent full-page `goto('/')` can tear
down before it flushes.

### Symptom 2: URL never matches `/projects/{id}/transcriptions` (static analysis)

Path: `app/src/routes/projects/+page.svelte` `createProject()` →
`projectId = await createProjectRecord({name})` (write is **awaited**; worker
`projects.create` completes and returns the id, `db.worker.ts:377-381`) →
`await openProject(id)` → `goto('/projects/[id]/transcriptions')`.

The test helper `createProject()` (dashboard.spec.ts:57-67) then does:

```
await expect(page.getByRole('heading', { name })).toBeVisible();
const match = new URL(page.url()).pathname.match(/^\/projects\/([^/]+)\/transcriptions$/);
```

Two problems combine:
- `getByRole('heading', {name})` is **ambiguous**. The `/projects` picker renders
  each project card title as an `<h3>` (`projects/+page.svelte:233`,
  `<h3 …>{project.name}</h3>`). The just-created project card is re-rendered onto
  the picker by the picker's own `subscribeLocalDbInvalidations` handler
  (`projects/+page.svelte:157-163`) reacting to the `projects` invalidation posted
  by the worker. That h3 satisfies the matcher **while still on `/projects`**,
  before/independently of `openProject`'s `goto` completing.
- `page.url()` is a **synchronous, non-retrying** snapshot. If the heading resolves
  against the picker card before navigation finishes, `page.url()` is still
  `/projects`, the regex fails, and the helper throws
  "Project URL did not identify …".

The transcriptions route also renders the name as an `<h1>`
(`projects/[id]/+layout.svelte:28`), so once navigation completes the heading is
still satisfied — which is exactly why this is a **timing race**, not a permanent
failure.

---

## (b) Evidence

### Per-run results — `bun run test:e2e -- dashboard.spec.ts` (from `app/`)

| Run | Test 1 (Continue/phase) | Test 2 (attention/start) | Test 3 (fresh profile) | Result |
|----:|-------------------------|--------------------------|------------------------|--------|
| 1   | PASS (8.1s)             | PASS                     | PASS                   | 3 passed |
| 2   | PASS (8.0s)             | PASS                     | PASS                   | 3 passed |
| 3   | PASS (8.9s)             | PASS                     | PASS                   | 3 passed |
| 4   | **FAIL (16.8s)**        | PASS                     | PASS                   | **1 failed** |
| 5   | inconclusive — run interrupted before results (build stage) | — | — | n/a |

Symptom 1 reproduced on run 4 (~1 in 4). Symptom 2 did not reproduce in these runs;
it is analyzed statically above. Each run rebuilds (vite build + preview), so the
worker/timing conditions differ slightly run to run, consistent with a timing race.

### Run 4 failure excerpt (exact)

```
✘  1 e2e/dashboard.spec.ts:5:1 › Continue resumes a collation at its current phase … (16.8s)

Error: expect(page).toHaveURL(expected) failed
Expected: "http://localhost:4173/collation/178a92c7-513e-416c-bccd-3c5d4280f2d7/alignment"
Received: "http://localhost:4173/collation/178a92c7-513e-416c-bccd-3c5d4280f2d7/setup"
Timeout:  5000ms
Call log:
  - Expect "toHaveURL" with timeout 5000ms
    2 × unexpected value "http://localhost:4173/collation/178a92c7-…"          <- bare route, pre-resolution
    7 × unexpected value "http://localhost:4173/collation/178a92c7-…/setup"    <- resolver landed on setup and stayed
      > 17 | await expect(page).toHaveURL(collationPath);   // collationPath = /collation/{id}/alignment
```

The URL settling and *staying* on `/setup` (7 samples) is the signature of the
persisted document carrying `phase:'setup'` — not a transient in-flight state. This
matches the root-cause ordering exactly.

---

## (c) Minimal recommended fix (do not implement here)

Persist the phase transition durably before leaving the setup step, so a reload /
worker teardown can never observe a stale `setup`. Smallest change that closes the
window:

1. **`app/src/lib/client/collation/collation-state.svelte.ts` — `setPhase`
   (lines 413-417):** have a phase transition mark the workspace dirty so it becomes
   flushable. Add `markUnsaved();` after `advanceFurthest(normalized);`.
   (`nextPhase` already calls `markUnsaved()`; `setPhase` is the inconsistent one.)

2. **`app/src/lib/components/collation/SetupPhase.svelte` — Proceed-to-Alignment
   handler (lines 890-910):** await a durable flush before navigating. After
   `collationState.setPhase('alignment');` and before the `goto(...)`, insert:
   `await collationState.flushPendingSave();`
   (`flushPendingSave`, `collation-state.svelte.ts:377-390`, is already exported and
   awaits the in-flight save + runs a persist when dirty. With fix #1 the state is
   dirty, so this actually writes `phase:'alignment'`/`furthestPhase:'alignment'`.)

Together these guarantee the persisted document is `alignment` before any navigation
or teardown. Fix #1 alone is insufficient (the 800 ms debounce could still be
outstanding at `goto('/')`); fix #2 alone is insufficient (`flushPendingSave`
no-ops when `saveStatus === 'saved'`, which is the state `setPhase` leaves behind).
Both are required.

Call sites to touch:
- `collation-state.svelte.ts` `setPhase` — 1 line added.
- `SetupPhase.svelte` Proceed handler — 1 `await` added.

No other `setPhase` caller needs changes, but for awareness the other callers are:
`ReadingsPhase.svelte:287`, `AlignmentGrid.svelte:208,223`, and
`collation/[id]/[phase]/+page.svelte:34` (the URL→state sync). Making `setPhase`
mark unsaved simply means those transitions also schedule an autosave, which is the
already-correct behavior for `nextPhase`; the `[phase]` sync effect only calls
`setPhase` when `phase !== requestedPhase`, so it will not thrash.

This is also a genuine product correctness fix, independent of the test: a user who
clicks Proceed and closes the tab within 800 ms today loses the phase advance.

### Optional hardening for Symptom 2 (test-side; app write is already correct)

The app create path is correct (write awaited before navigate). To make the E2E
deterministic, tighten the test's ambiguous wait, e.g. assert on the transcriptions
page's project `<h1>` specifically, or replace the synchronous `page.url()` check
with `await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/)` (which
retries). If an app-side change is preferred, the picker could avoid re-rendering
the just-created card before navigating (e.g. not react to its own `projects`
invalidation while a create-driven `goto` is pending) — but that is defensive; the
primary defect is the test selector.

---

## (d) Do symptoms 1 and 2 share a cause?

**No.** They are distinct root causes in the same family (SvelteKit navigation vs.
the local-db async/invalidation layer):

| | Symptom 1 (stale phase) | Symptom 2 (post-create nav) |
|---|---|---|
| Is the relevant write awaited? | **No** — `setPhase` never persists; only an 800 ms debounced autosave does | **Yes** — `await createProjectRecord()` completes the worker write |
| Failure mechanism | A **not-yet-flushed write** is read back stale after a full-page reload tears down the worker | An **invalidation-driven re-render** satisfies an ambiguous DOM matcher before `goto` completes; a non-retrying `page.url()` reads the stale URL |
| Where the defect lives | App source (`setPhase` / Proceed handler don't flush) | Test (ambiguous `getByRole('heading')` + non-retrying `page.url()`); app write is correct |
| Fix | Persist phase before navigating | Tighten the test wait (or defensively avoid picker self-re-render) |

Evidence for the distinction: Symptom 1's reproduced failure shows the URL
*settling and staying* on `/setup` (persisted-state signature), i.e. a durability
problem — whereas Symptom 2's described failure is a URL that "never matched"
because the assertion resolved early against `/projects`, i.e. an
assertion-timing/selector problem with the write already durably committed. The
"failing at two different steps" pattern is explained not by one shared race but by
two independent nav-vs-async races surfacing in the same spec.
