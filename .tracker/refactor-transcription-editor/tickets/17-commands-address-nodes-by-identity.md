# Ticket 17: Commands address nodes by identity, not cached position

## Parent

`../INVENTORY.md` F8, F18, F26.

## What to build

Every page command and every inspector write takes an absolute document position that was cached at some earlier moment and never remapped. Today this is safe by accident. Make it safe by construction.

- **F8** page commands address pages by cached absolute position.
- **F18** `updateNodeAttrs` throws on a position past the end of the document instead of failing cleanly.
- **F26 was superseded by ticket `19`.** Page chrome now derives directly from `fw` children, so `syncPageFormWorkToContainingPage` and its scan no longer exist.

## Where to start

**F8** — `TranscriptionEditor.svelte:134` builds `pages` as `{ pos, pageId, … }`, rebuilt only when the metadata dialog fires `toggle`, when the drawer opens, or when the IIIF workspace is open. Nothing remaps those positions through intervening transactions, and `updatePageName` (`:437`), `deletePage` (`:458`) and `updatePageFormWork` (`:476`) each take one as an argument.

**This is not a live defect, and the reason matters:** the metadata dialog is a true modal (`dialog.showModal()`), so while it is open the editor is inert and no transaction can shift a position. The spec asserts exactly that. The dependency is invisible and undocumented, which is the problem — a later ticket that makes the dialog non-modal, or adds a background transaction, breaks every page command silently.

**F18** — `editorCommands.ts:87`. `state.doc.nodeAt(pos)` throws `RangeError: Position … outside of fragment` for a position beyond the document, so the `if (!node) return false` guard never runs. Every inspector passes `selectedNode.pos` straight in (`TeiNodeInspector.svelte:90`). A position captured before a deletion that shrank the document crashes the command. Tagged: `DEFECT F18` note at `editorCommands.svelte.spec.ts:349`.

**F26 (superseded)** — ticket `19` removed the mirrored page-chrome attributes and the synchronization callback entirely. With no parent cache to update, there is no containing-page lookup to optimize.

## Contract

- Page commands take a `pageId`, not a position. The ids already exist and are stable; the position is the thing being recomputed.
- `updateNodeAttrs` never throws on an out-of-range position. It clamps or resolves through the current selection and returns `false` when the node cannot be found. Returning `false` is a valid outcome and callers already handle it.
- ~~`syncPageFormWorkToContainingPage` resolves the containing page as an ancestor in O(depth), not by scanning from 0.~~ Superseded by ticket `19`, which removed this seam.
- Behaviour is unchanged for every case that works today. This is a robustness ticket: the visible result of every command stays the same.
- The `pages` array may keep a `pos` field for rendering if something needs it, but no command may take one as its argument.

## Out of scope

- Making the metadata dialog non-modal, or changing when `pages` is rebuilt.
- The inspector draft-syncing pattern (F32) — deferred until after the ticket 22 decision.
- The other full-document scans in `getCurrentCursorPosition` — ticket 04 owns those.
- Milestone resolution — ticket 18.

## Acceptance criteria

- [x] `updatePageName`, `deletePage` and `updatePageFormWork` take a page id.
- [x] Each still operates on the correct page of a three-page document.
- [x] `updateNodeAttrs` with a position past the end of the document returns `false` and does not throw.
- [x] `updateNodeAttrs` still succeeds for every position that works today.
- [x] Superseded by ticket `19`: `syncPageFormWorkToContainingPage` no longer exists because page chrome is derived rather than synchronized.
- [x] A test asserts a page command works after a transaction has shifted document positions — the case the modal currently hides.
- [x] Baseline passes.

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

## Implementation note

2026-07-28: Paused because concurrent ticket `19` work directly changed the same command seam and files. It removed `syncPageFormWorkToContainingPage` while this ticket's contract requires changing that function to ancestor resolution, and it is concurrently editing `TranscriptionEditor.svelte`, `pageFormwork.ts`, `editorCommands.ts`, and both shared command specs. The completed ticket `17` worktree changes are the out-of-range `updateNodeAttrs` guard and test plus page-id-addressed metadata commands and shifted-position coverage; they are not committed. Reconcile ticket `17` with ticket `19` after the latter's intended architecture is known.

2026-07-28: Reconciled after ticket `19` completed. Its removal of mirrored page chrome is authoritative and supersedes F26 rather than requiring a replacement lookup. F8 and F18 remain unchanged.
