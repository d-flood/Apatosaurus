# Ticket 03: ProseMirror owns cursor placement

## Parent

`../SPEC.md` § D1, § A.

## What to build

Clicking anywhere on a line currently puts the cursor at the beginning of that line instead of where the user clicked. Delete the code that causes it, and leave ProseMirror's native hit-testing in charge.

This is a removal ticket. There is no replacement mechanism to write — ProseMirror already computes the right answer and the editor discards it.

## Where to start

Measured on a line containing "Alpha": the line box is 844 px wide, the contentDOM (`.line-content`) is 39 px, leaving a 770 px dead zone. `view.posAtCoords()` at a click in that dead zone returns **8**, the correct end-of-word position. After the click, `state.selection` is **3**, the line's start.

Five writers to remove, all but the last in `app/src/lib/client/transcriptionEditorSchema.ts`:

1. **`handleClick`** on the `main-manuscript` profile in `createEditorForProfile` (added by commit `655a97d`). Forces every click outside `.line-content` to position 1 of the line. Delete it.
2. **`handleDOMEvents`** returning `true` for `mousemove`, `mouseenter`, `mouseleave`, `dragover`, `dragenter`, `dragleave` — returning `true` suppresses ProseMirror's own handling of those events. Ticket 01 question 2 establishes whether any of these serve `IiifWorkspace` or the inspector drawer; delete the ones that do not, and document the reason for any survivor in a comment.
3. **`PunctuationHighlighter.appendTransaction`** — the unconditional `tr.setSelection(TextSelection.near(...))` at the end. An `appendTransaction` that only adds marks must not touch the selection; mark steps do not move positions. As written it also silently downgrades a `NodeSelection` to a text cursor on any document change.
4. **The `Line` node's `Enter` shortcut** — the `queueMicrotask(() => editor.chain().focus().setTextSelection(pos).run())` layered on a transaction that already set the selection. Delete the microtask and make the transaction authoritative. Ticket 02 leaves this in place deliberately.
5. **`restoreMappedSelection`** — used by the repair and normalize paths. Ticket 04 removes most of its call sites. Whatever survives must not map a selection through a full-document replace.

`app/src/lib/components/transcriptionEditor/editorInteractions.ts` is read-only with respect to selection today. Keep it that way.

Note: `.tracker/files-as-database/tickets/20-editor-selection-side-effects-and-harness.md` attributed cursor jumps to a debounce feedback loop in `editorInteractions.ts`. Measurement does not support that. Do not spend time there.

The empty-line case is why `handleClick` was added. `.line-content` carries `min-width: 1px`, so an empty line still has a 1 px content target. Verify by test that clicking an empty line places the cursor in it after the deletion. If it genuinely does not, the fallback is a handler conditioned on the line being empty — never one that fires for non-empty lines.

## Contract

- Clicking at any horizontal position on a line places the cursor at the nearest text position, including past the end of the text.
- Clicking the line-number gutter or the wrapped-arrow does not move the cursor to a different line.
- Clicking an empty line places the cursor in that line.
- A `NodeSelection` survives an unrelated document change elsewhere in the document.
- No plugin's `appendTransaction` sets the selection unless it moved content.
- Drag-selection across lines works.

## Out of scope

- Making `.line-content` fill the line box. That removes the 770 px dead zone structurally and belongs to a later ticket written from ticket 01's inventory. This ticket only stops the override; some of the dead zone remains until then.
- The punctuation plugin's per-keystroke document scan and its per-text-node de-duplication bug — those are cost and correctness, and belong to ticket 04 and the inventory respectively. Touch only the `setSelection` call.
- `TranscriptionEditor.svelte`'s `update`/`selectionUpdate` handlers.

## Acceptance criteria

- [ ] Browser-mode test: a click at 90% of a line's width lands at the end of that line's text, not at position 1.
- [ ] Browser-mode test: a click on the line-number gutter does not move the cursor to another line.
- [ ] Browser-mode test: a click on an empty line places the cursor in that line.
- [ ] Test: a `NodeSelection` on a carrier atom survives a text edit on a different line.
- [ ] `handleClick` is gone from the `main-manuscript` profile.
- [ ] Every surviving `handleDOMEvents` entry has a comment naming what it fixes.
- [ ] Net change across the touched files is a reduction in lines.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm run check
pnpm run test:unit -- --run
git diff --stat -- src/lib/client/transcriptionEditorSchema.ts
```

Success: the editor specs pass including the new click tests; `check` and the unit suite pass; `git diff --stat` shows more deletions than insertions in `transcriptionEditorSchema.ts`.

## Blocked by

- Ticket 01 (`01-editor-code-quality-inventory.md`) — specifically its question 2, on whether any `handleDOMEvents` suppression is load-bearing for `IiifWorkspace` or the inspector drawer.
