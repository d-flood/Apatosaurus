# Ticket 17: Commands address nodes by identity, not cached position

## Parent

`../INVENTORY.md` F8, F18, F26.

## What to build

Every page command and every inspector write takes an absolute document position that was cached at some earlier moment and never remapped. Today this is safe by accident. Make it safe by construction.

- **F8** page commands address pages by cached absolute position.
- **F18** `updateNodeAttrs` throws on a position past the end of the document instead of failing cleanly.
- **F26** `syncPageFormWorkToContainingPage` finds the containing page by scanning from position 0, when the page is an ancestor.

## Where to start

**F8** — `TranscriptionEditor.svelte:134` builds `pages` as `{ pos, pageId, … }`, rebuilt only when the metadata dialog fires `toggle`, when the drawer opens, or when the IIIF workspace is open. Nothing remaps those positions through intervening transactions, and `updatePageName` (`:437`), `deletePage` (`:458`) and `updatePageFormWork` (`:476`) each take one as an argument.

**This is not a live defect, and the reason matters:** the metadata dialog is a true modal (`dialog.showModal()`), so while it is open the editor is inert and no transaction can shift a position. The spec asserts exactly that. The dependency is invisible and undocumented, which is the problem — a later ticket that makes the dialog non-modal, or adds a background transaction, breaks every page command silently.

**F18** — `editorCommands.ts:87`. `state.doc.nodeAt(pos)` throws `RangeError: Position … outside of fragment` for a position beyond the document, so the `if (!node) return false` guard never runs. Every inspector passes `selectedNode.pos` straight in (`TeiNodeInspector.svelte:90`). A position captured before a deletion that shrank the document crashes the command. Tagged: `DEFECT F18` note at `editorCommands.svelte.spec.ts:349`.

**F26** — `editorCommands.ts:125`. Behaviour is correct — the spec confirms the label lands on the correct page of three — only the method is wrong. `state.doc.resolve(pos)` and walk up.

## Contract

- Page commands take a `pageId`, not a position. The ids already exist and are stable; the position is the thing being recomputed.
- `updateNodeAttrs` never throws on an out-of-range position. It clamps or resolves through the current selection and returns `false` when the node cannot be found. Returning `false` is a valid outcome and callers already handle it.
- `syncPageFormWorkToContainingPage` resolves the containing page as an ancestor in O(depth), not by scanning from 0.
- Behaviour is unchanged for every case that works today. This is a robustness ticket: the visible result of every command stays the same.
- The `pages` array may keep a `pos` field for rendering if something needs it, but no command may take one as its argument.

## Out of scope

- Making the metadata dialog non-modal, or changing when `pages` is rebuilt.
- The inspector draft-syncing pattern (F32) — deferred until after the ticket 22 decision.
- The other full-document scans in `getCurrentCursorPosition` — ticket 04 owns those.
- Milestone resolution — ticket 18.

## Acceptance criteria

- [ ] `updatePageName`, `deletePage` and `updatePageFormWork` take a page id.
- [ ] Each still operates on the correct page of a three-page document.
- [ ] `updateNodeAttrs` with a position past the end of the document returns `false` and does not throw.
- [ ] `updateNodeAttrs` still succeeds for every position that works today.
- [ ] `syncPageFormWorkToContainingPage` contains no `descendants` or `nodesBetween` call.
- [ ] A test asserts a page command works after a transaction has shifted document positions — the case the modal currently hides.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor/editorCommands.svelte.spec.ts
pnpm vitest run --project client src/lib/components/transcriptionEditor/transcriptionEditorCommands.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: page commands are id-addressed, the out-of-range case fails cleanly, and the new shifted-position test passes.

## Blocked by

None - can start immediately.
