# Ticket 23: Correction drafts and drawers target what they opened

## Parent

`../INVENTORY.md` F43, F38.

## What to build

Two editing surfaces that hold a reference to "the thing being edited" which can silently come to mean something else.

- **F43** the correction workspace tracks the reading being edited by array index. Removing an earlier reading shifts the edited one without decrementing the index, so Save either finds nothing and discards the draft, or overwrites a *different* reading that now occupies the stale slot. Every reading's Edit and Remove control stays active while a draft is open.
- **F38** the correction and abbreviation drawers read the current mark but retain neither its range nor its identity. The main editor deliberately keeps them open across text-selection changes, and Apply/Remove then call `setMark`/`unsetMark` against whatever is selected *now*. A draft opened for selection A can be written onto selection B; Remove can strip a mark the user never opened.

## Where to start

**F43** — `CorrectionWorkspace.svelte:90` and `:204`. `editingIndex` is the array index.

**F38** — `TranscriptionEditor.svelte:288` and `:408` (the drawer open/keep-open logic), `editorInteractions.ts:135`, `InlineCarrierWorkspace.svelte:444` (the same pattern in the nested workspace).

**F38 is labelled read, not executed.** Reproduce it before fixing it — the behaviour may already be masked by a drawer close somewhere on the selection-change path. If it does not reproduce, say so in `TRACKER.md` and close that half; do not fix a bug you could not demonstrate.

## Contract

- The correction workspace addresses the reading under edit by **identity**, not by array position. Readings already need stable identity for this to work; if they do not have it, giving them some is part of the ticket.
- Removing any reading while a draft is open either leaves the draft pointing at the same reading, or closes the draft explicitly. It never writes to a different one.
- A drawer holds the range or mark identity it was opened for. Apply and Remove act on that, not on the current selection.
- When the target no longer exists — its text was deleted, the mark was removed elsewhere — the drawer closes or disables its actions rather than falling back to the selection.
- The same treatment applies to `InlineCarrierWorkspace`'s copy of the pattern, or `TRACKER.md` records why it does not need it.

This is `../SPEC.md` § A in the UI layer: a drawer treats "the selection" as a stable handle on a thing, when it is a live cursor position that anything can move.

## Out of scope

- The inspector merge behaviour — ticket 21.
- The `JSON.stringify` draft-syncing pattern (F32) — after ticket 22.
- Redesigning the drawers or changing when they open and close, beyond what the contract requires.

## Acceptance criteria

- [ ] Opening a draft on reading 2 of 3, removing reading 1, then saving updates reading 2 and no other.
- [ ] The same sequence with the draft on the last reading.
- [ ] Removing the reading currently under edit closes the draft rather than leaving it pointing at a neighbour.
- [ ] F38 is either reproduced and fixed — a draft opened on selection A, with the selection then moved to B, applies to A — or `TRACKER.md` records that it does not reproduce and why.
- [ ] Remove, with the selection moved away from where the drawer was opened, strips the intended mark and no other.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor/inlineCarrierWorkspace.svelte.spec.ts
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm run check
pnpm run test:unit -- --run
```

Success: the reading-removal sequences are asserted through a mounted workspace and pass; the F38 half is either fixed with a test or documented as not reproducible.

## Blocked by

None - can start immediately.
