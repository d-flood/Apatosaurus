# Ticket 02: Enter no longer duplicates the column

## Parent

`../SPEC.md` § D4, § F1.

## What to build

Pressing Enter in the middle of a line inside a multi-line column currently duplicates every other line in that column. Make it split the line and nothing else.

This is live document corruption in the shipped editor. It is deliberately independent of the rest of the epic and should not wait for ticket 01.

## Where to start

`app/src/lib/client/transcriptionEditorStructure.ts`, the end of `createLineSplitTransaction`:

```js
const replacement = [...linesBefore, firstLine, secondLine, ...linesAfter].map(...);
const tr = state.tr.replaceWith(linePos, linePos + currentLine.nodeSize, replacement);
```

`replacement` is the whole column's line list. The replaced range is only the current line. So the column is re-inserted in place of one line.

Reproduction through the real Enter keybinding:

```
BEFORE: ["alpha","beta","gamma"]      cursor mid-"beta", press Enter
AFTER : ["alpha","alpha","be","ta","gamma","gamma"]
WANTED: ["alpha","be","ta","gamma"]
```

A single-line column is the only shape that behaves correctly, because `linesBefore` and `linesAfter` are then both empty.

Two directions are available. **Prefer the first:** replace only the current line's range with `[firstLine, secondLine]`, which makes `linesBefore`/`linesAfter` dead and deletable, and lets the existing normalizer handle numbering. Only widen the replaced range to the whole column instead if option one turns out to break the `lineId` or selection contract below — and record why in `TRACKER.md` if so.

`createColumnSplitTransaction` has the same shape but replaces the *whole column's* range, so it is correct. Do not "fix" it. `createEmptyLineInsertTransaction` is also correct.

The existing test is at `app/src/lib/client/transcriptionEditorStructure.svelte.spec.ts`, "splits the current line in place and keeps selection in the same column". It uses a single-line column, which is why it passes today. Widen it; do not merely add beside it.

Editor mounting pattern for new specs is in that same file. Browser-mode runs go through `pnpm vitest run --project client <path>`.

## Contract

- Splitting a line changes its column's line count by exactly one.
- No line other than the split line has its content changed, in that column or any other.
- `LINE_SPLIT_TARGET_LINE_ID_META` still carries the id of the second (new) line, and the selection lands at that line's start.
- The column's `zone` and `columnId` survive; every untouched line's `lineId` survives.
- Splitting an empty line continues to go through `createEmptyLineInsertTransaction` — the `Enter` shortcut tries it first, and that ordering is unchanged.

## Out of scope

- The `queueMicrotask(() => editor.chain().focus().setTextSelection(pos).run())` in the `Line` node's `Enter` shortcut. It is an anti-pattern and belongs to ticket 03; leave it working.
- Removing `lineNumber` attributes or touching `LineNumberNormalizer`.
- `createColumnSplitTransaction` and `createEmptyLineInsertTransaction`.

## Acceptance criteria

- [ ] Splitting the middle line of a 4-line column yields exactly 5 lines with the expected text.
- [ ] The same, driven through the real Enter keybinding rather than by calling the exported function directly.
- [ ] Splitting a line in a multi-column page leaves sibling columns byte-identical.
- [ ] Splitting a line in a multi-page document leaves other pages byte-identical.
- [ ] Splitting the only line of a single-line column still behaves as before.
- [ ] Reverting the production fix makes the new tests fail (verify once, then re-apply).
- [ ] Net change to `transcriptionEditorStructure.ts` is a reduction in lines.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/client/transcriptionEditorStructure.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
git diff --stat -- src/lib/client/transcriptionEditorStructure.ts
```

Success: the structure spec passes including the new multi-line cases; `check` and the unit suite pass; `git diff --stat` shows more deletions than insertions in `transcriptionEditorStructure.ts`.

## Blocked by

None - can start immediately.
