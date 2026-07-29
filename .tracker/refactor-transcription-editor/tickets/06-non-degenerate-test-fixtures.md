# Ticket 06: Non-degenerate test fixtures

## Parent

`../SPEC.md` § "Non-degenerate test fixtures", and `../INVENTORY.md` § "What this
inventory does not establish", point 2.

## What to build

A shared fixture and harness layer for the editor's specs, under
`app/src/lib/client/testing/` (new directory), plus the migration of the existing
editor specs onto it.

This is the epic's first implementation ticket, and it is deliberately first. It
changes no production code. Its purpose is that every ticket after it can prove
it preserved behaviour — and that the defects the inventory did not find have
somewhere to surface.

## Why this comes first

The suite's fixtures are degenerate: one page, one column, one line. That is not
a style complaint, it is the direct cause of shipped defects.

- `transcriptionEditorStructure.svelte.spec.ts`'s "splits the current line in
  place" test builds a column with **exactly one line** — the only shape for
  which the D4 corruption cannot occur — and passes. The bug it was written to
  prevent shipped underneath it.
- F6, F10 and F14 were never reported by anyone. All three fell out within an
  afternoon of running ordinary user actions against a three-page, two-column,
  four-line fixture. Three unreported document-destroying defects from one change
  of fixture shape is the argument for this ticket.

The second reason is ordering. Every remaining ticket in this epic — renumbering,
chrome leaving `renderHTML`, the layout model — is a behaviour-preserving
refactor. A behaviour-preserving refactor with no way to demonstrate preserved
behaviour is a rewrite. Build the net first.

## Where to start

Ticket `01` produced eight specs that contain, in ad-hoc form, most of what this
layer needs. **Extract from them; do not invent a parallel design.** Current
duplication, which this ticket also resolves:

| Helper | Duplicated across |
| --- | --- |
| `createTestEditor` | 5 specs |
| `line` / `column` / `page` builders | 4 / 2 / 1 |
| `waitFor` | 3 |
| `domShape`, `placeCaretAtEndOf`, `tick`, `control` | 2 each |

### What the layer needs

**Document builders** — composable, defaulting to non-degenerate shapes:

- a column of ≥ 4 lines
- a plain page of ≥ 2 columns
- a five-zone framed page (`top`/`left`/`center`/`right`/`bottom`)
- a ≥ 3-page document where the *middle* page is the interesting one
- the marginalia equivalent for the `formwork-nested` profile
  (`marginaliaColumn` / `marginaliaLine`)
- both shapes: editor JSON (`type: 'manuscript'`) and `TranscriptionDocument`
  (`type: 'transcriptionDocument'`), since the mounted-component harness takes
  the latter and `initializeEditorContent` takes the former

**Assertion helpers**

- a whole-document snapshot — `page -> column -> line` text, from the document
  *and* from the DOM, so a spec can assert the view and the model agree
- an attribute snapshot for the structural nodes, so renumbering tickets can
  assert what changed and what did not

**Mount harnesses** — both already exist in ticket `01`'s specs and should move
here:

- `TranscriptionEditor` mounted with a fixture, exposing its container and a
  disposer. Its commands are drivable through the real toolbar by `aria-label`.
- `InlineCarrierWorkspace` mounted with a fixture. **It is a controlled
  component** — the harness must echo `onChange` back into `initialContent` via a
  `$state` prop object, as its real parents do, or it reverts its own view one
  tick after any structural command.

### Traps that cost time in ticket 01

Put these in the layer so they are paid once.

1. **`initializeEditorContent` does not assign `lineId` or `columnId`** (F7). The
   normalizer only runs from `appendTransaction`, so a freshly loaded fixture has
   `null` identity on every line, and `findLineStartPositionById` cannot address
   any of it. Builders should take ids explicitly. The live app hides this by
   running `repairManuscriptStructureJson(…, { ensureNodeIds: true })` at mount;
   fixtures must not rely on that.
2. **The `client` vitest project does not load `app.css`.** A mounted component
   gets the Svelte `<style>` block's `:global` rules and no Tailwind utilities.
   Any layout measurement must inject `app.css?inline` in `beforeAll` or its
   numbers are meaningless — see `transcriptionEditorLayout.svelte.spec.ts`.
3. **Toolbar popovers are `id="${idPrefix}-${name}"`**, so select with
   `[id$="popover-insert-page"]`, not `^=`. Pass a unique `toolbarIdPrefix` per
   mount or concurrent harnesses collide.
4. **Placing a caret** needs a real DOM range plus focus on the `.ProseMirror`
   element, then a tick before the command runs.
5. A wedged `vitest` process makes later runs report `no tests`. `pkill -f vitest`
   before re-running if a run is interrupted.

### Migration

Move every editor-area spec onto the layer. The rule from `SPEC.md`: **operate on
a middle element of a multi-element parent**, and keep the degenerate case as
extra coverage rather than the only coverage.

`selection-stability.svelte.spec.ts` needs particular attention and is the one
place where deletion may be the answer. Its `simulatePageTracking` and
`simulateIiifPageChange` helpers re-implement editor logic inside the test, so
they assert that the test's own copy is stable. Point them at the real code paths
or delete them; do not migrate them as they are.

## Contract

- One module (or small set) under `app/src/lib/client/testing/`, imported by
  specs only. Nothing in `src/lib` outside `testing/` may import it.
- Builders take an options object and return plain JSON. No hidden randomness —
  a fixture must produce identical output across runs so snapshots are stable.
- Ids are explicit and deterministic (`line-1`, `col-2`, `page-1`), not
  `crypto.randomUUID()`, so failures are readable.
- The harnesses return a disposer and are safe to call in `finally`.
- Every migrated spec keeps its `DEFECT F<n>` tags. Those tags are the contract
  between the inventory and the tickets that fix each finding; losing them in a
  migration would break the epic's definition of done.

## Expected output beyond the code

Findings. Running the existing assertions against non-degenerate fixtures is the
point, and it is likely to fail somewhere. **Append new findings to
`INVENTORY.md` with the next free `F<n>`** rather than starting a new document,
and add a line to `TRACKER.md` Notes. If a migrated spec fails, that is a
discovery, not a migration error — record it before deciding whether to fix it
here or ticket it.

## Out of scope

- Fixing anything the migration uncovers, unless it is as severe as F6 or F14.
  File it.
- Production code. This ticket touches `app/src/**/*.spec.ts` and the new
  `testing/` directory only.
- `triiiceratops`, collation, the TEI file format.
- Adding new test *cases* beyond what migration requires. Coverage expansion
  belongs to the tickets that fix each finding, which is where the tagged
  assertions get flipped.

## Acceptance criteria

- [ ] Shared builders exist for: ≥ 4-line column, ≥ 2-column plain page, five-zone
      framed page, ≥ 3-page document, marginalia document — in both editor-JSON
      and `TranscriptionDocument` shapes.
- [ ] Whole-document snapshot helpers exist for the model and the DOM.
- [ ] Mount harnesses for `TranscriptionEditor` and `InlineCarrierWorkspace` live
      in the layer, and the specs from ticket `01` use them instead of their own
      copies.
- [ ] No editor-area spec defines its own `createTestEditor`, `waitFor`,
      `domShape`, `placeCaretAtEndOf`, `tick` or `control`.
- [ ] Every migrated structural spec operates on a **middle** element of a
      multi-element parent; degenerate cases remain as additional coverage.
- [ ] `selection-stability.svelte.spec.ts` either exercises real code paths or is
      deleted, with the reason recorded in `TRACKER.md`.
- [ ] All `DEFECT F<n>` tags survive the migration.
- [ ] Any new findings are appended to `INVENTORY.md`.
- [ ] Baseline passes.

```bash
cd app
pnpm run check
pnpm run test:unit -- --run
```

Success: `check` reports no errors; the unit suite passes; the editor-area spec
count does not drop.

## Blocked by

None. This is the epic's first implementation ticket and everything else is
easier after it.
