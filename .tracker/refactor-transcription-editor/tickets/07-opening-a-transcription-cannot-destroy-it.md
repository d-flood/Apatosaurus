# Ticket 07: Opening a transcription cannot destroy it

## Parent

`../INVENTORY.md` § "Raise immediately", F6 and F14.

## What to build

Two independent ways that the first few seconds after opening a transcription can destroy the whole manuscript. Both are live. Both are small.

1. **F6** — clicking "Insert Page" before clicking into the editor replaces the entire document with one empty page.
2. **F14** — the document load is itself an undoable history event, and the user's first keystroke is grouped with it, so an early `Ctrl+Z` empties the manuscript.

They are one ticket because they share a theme and a test setup: the state of a freshly-opened, not-yet-touched editor. Fix them in either order.

## Where to start

**F6** — `app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte:822` `insertPage` and `:861` `insertFramedPage`. Both call `editor.commands.insertContent({ type: 'page', … })`. `insertContent` inserts at `state.selection`; until the user puts a caret in the editor that is whatever TipTap created at construction, and fitting a block `page` node there makes ProseMirror's fitter resolve the mismatch by replacing everything.

```
BEFORE: 3 pages — [['a1','a2','a3','a4']], [['b1'…],['c1'…]], [['d1'…]]
ACTION: click "Insert Page", type a name, confirm — without first clicking into the editor
AFTER : 1 page  — [['']]
WANTED: 4 pages — the original three, plus one empty page
```

With a caret placed first, both commands already behave correctly.

**F14** — `app/src/lib/client/editorContentInitialization.ts:13` `initializeEditorContent` calls `editor.commands.setContent(content, { emitUpdate: false })`. `emitUpdate: false` suppresses the update *event*; it does not keep the transaction out of history.

Existing coverage to extend, not duplicate: `app/src/lib/client/transcriptionEditorHistory.svelte.spec.ts` already has three `DEFECT F14` assertions, and `app/src/lib/components/transcriptionEditor/transcriptionEditorCommands.svelte.spec.ts:96` and `:109` have two `DEFECT F6` assertions. **Flip those expectations rather than writing new tests beside them** — they encode the defect deliberately.

Shared fixtures and the mounted-editor harness are in `app/src/lib/client/testing/`.

## Contract

- A `page` insert point is derived from the **document**, not from the selection: `doc.content.size`, or the end of the page containing the caret when there is one. A page is a top-level node and its insert position must never depend on where the selection happens to be.
- Inserting a page never changes the content of any existing page.
- Both `insertPage` and `insertFramedPage` get the same treatment. Do not fix one.
- A freshly loaded, unedited transcription reports `editor.can().undo() === false`.
- The first keystroke after load is its own history event; one undo removes that keystroke and leaves the loaded document intact.
- `initializeEditorContent`'s init-only invariant (from `files-as-database` ticket 19) still holds.

## Out of scope

- Re-implementing the `dispatch` monkey-patch in `editorContentInitialization.ts` (anti-pattern F3). Ticket 04 owns it; leave it working.
- Addressing pages by id rather than cached position — ticket 17.
- Any other use of `insertContent` in the toolbar.

## Acceptance criteria

- [ ] Inserting a page into a 3-page document without first focusing the editor yields 4 pages, with the original three byte-identical.
- [ ] The same for `insertFramedPage`, including its five zones.
- [ ] Inserting a page *with* a caret placed still works, and the new page lands after the page containing the caret.
- [ ] A freshly loaded, unedited editor reports `can().undo() === false`.
- [ ] Load, type one character, undo once: the character is gone and the manuscript is intact.
- [ ] The same after the history grouping window (`newGroupDelay`) has elapsed.
- [ ] The five existing `DEFECT F6` / `DEFECT F14` assertions are inverted in place, not deleted.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/client/transcriptionEditorHistory.svelte.spec.ts
pnpm vitest run --project client src/lib/components/transcriptionEditor/transcriptionEditorCommands.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: both specs pass with the inverted expectations; `check` reports 0 errors; the unit suite is green.

## Blocked by

None - can start immediately.
