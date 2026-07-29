# Ticket 13: Node lookups stop at the first match

## Parent

`../INVENTORY.md` F5, F10.

## What to build

One bug at two sites. Returning `false` from a `descendants` callback stops the **descent**, not the **walk** — siblings keep being visited. Both functions therefore scan the whole document after they have already found what they wanted, and both return the *last* match rather than the first.

One of the two has a visible consequence today.

## Where to start

**F10 — `findFirstLineInsertPos`, `pageFormwork.ts:170`.** This is the one users see. Setting a page label, running title, catchword or quire signature inserts the `fw` node into the page's **bottom** line:

```
BEFORE: page 3 = ['d1','d2','d3','d4']
ACTION: set Page label = "fol. 2r"
AFTER : ['d1','d2','d3','fol. 2rd4']
WANTED: ['d1fol. 2r','d2','d3','d4']
```

The page's own `pageLabel` attribute is set correctly, so the dialog shows the right value and only the transcription is wrong.

**F5 — `findLineStartPositionById`, `transcriptionEditorStructure.ts:739`.**

```js
doc.descendants((node, pos) => {
    if (node.type.name !== 'line') return true;
    if (node.attrs?.lineId === lineId) { position = pos + 1; return false; }
    return false;
});
```

Note the corrected reachability: duplicate `lineId`s do **not** come from the split builders. `createLineSplitTransaction` mints a fresh id for its second half (`:637`) and backfills any null (`:645`); `createColumnSplitTransaction` sets the second half's id to `null` (`:541`). Duplicates come from **F1** reinserting sibling lines while the originals remain — so ticket 02 removes the only known source, which is why this ticket is blocked by it.

That makes F5 the tidy-up half: after ticket 02 the last-match behaviour is unreachable in practice, and what remains is a full-document scan on the Enter cursor-placement path plus a function that silently returns the last of several matches — a trap for the next caller.

Tagged assertions: `DEFECT F5` in `transcriptionEditorStructuralCommands.svelte.spec.ts:327`, `DEFECT F10` in `transcriptionEditorCommands.svelte.spec.ts:327`.

## Contract

- Both become one shared helper that stops at the first match and does not visit further siblings. Two call sites, one implementation.
- The helper returns the **first** match in document order.
- With duplicate ids present, the helper returns the first — asserted directly, since ticket 02 makes duplicates unreachable through normal editing but the guarantee should not depend on that.
- `updatePageFormWork` inserts into the page's first line.
- The scan visits no node after the match. Assert this by counting callback invocations, not by timing.

## Out of scope

- Replacing id-based lookup with position-based lookup, or vice versa — ticket 17 covers addressing.
- `findLineStartPositionInDoc` in `InlineCarrierWorkspace.svelte`, unless it turns out to be a third instance of the same bug. If it is, fold it in and say so.
- Anything about how `fw` nodes are classified or rendered.

## Acceptance criteria

- [ ] Setting a page label on a 4-line page inserts the `fw` into line 1, not line 4.
- [ ] The same for running title, catchword and quire signature.
- [ ] `findLineStartPositionById` returns the first match when two lines share an id.
- [ ] The `descendants` callback is invoked no more times than the position of the match requires — asserted with a counter.
- [ ] Both tagged assertions are inverted in place.
- [ ] The two functions share one implementation.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/client/transcriptionEditorStructuralCommands.svelte.spec.ts
pnpm vitest run --project client src/lib/components/transcriptionEditor/transcriptionEditorCommands.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: both tagged assertions inverted and passing; baseline green.

## Blocked by

- Ticket 02 (`02-enter-no-longer-duplicates-the-column.md`) — it removes the only known source of duplicate line ids, which is what makes F5's last-match behaviour reachable.
