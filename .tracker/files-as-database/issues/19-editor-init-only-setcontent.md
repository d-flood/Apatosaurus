# Issue 19: Editor Init-Only setContent

Architecture reference: `../architecture.md` sections 1 (audit findings), 6 (single-writer rule); root causes in `../current-state.md` section 8

## What to build

Eliminate the primary cause of "cursor jumps to a different line": every post-initialization full-document replacement is removed. `setContent` is permitted exactly once per document load; all later document mutations are selection-preserving ProseMirror transactions.

Start with an audit: inventory every `editor.commands.setContent(...)` call and every structure-mutating path, and record a disposition for each — allowed (init-only), converted to a mapped transaction, or deleted.

## Where to start

- `app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte` — load path (`setContent` with `emitUpdate: false`) and autosave interaction.
- `app/src/lib/components/transcriptionEditor/InlineCarrierWorkspace.svelte` — has its own `setContent` calls and manual selection math.
- `app/src/lib/client/transcriptionEditorStructure.ts` — `repairManuscriptStructureJson`, line splitting, generated IDs.
- Record the inventory and dispositions as a dated entry in `TRACKER.md`'s Notes (the reviewer checks dispositions against the diff).
- Note: the single-writer autosave rule (canonical document replaced only after the working-file write resolves) landed in issue 05 — verify it holds; do not rebuild it.

## Contract

- Structure repair runs on the loaded JSON **before** the initial `setContent`, never against a live document.
- Post-load structural fixes (line splitting, ID assignment) are ProseMirror transactions using position mapping (`tr.mapping`) so the selection survives; TipTap commands where they suffice.
- Enforcement: a dev-mode assertion (or lint rule) fails loudly on any `setContent` after initialization.
- No autosave or merge path feeds a document back into the editor; differences between `mergeWithCanonicalDocument` output and editor state stay outside the editor and reconcile at commit.
- `InlineCarrierWorkspace` may keep `setContent` for its own isolated editor instance if its selection lives entirely within the workspace — document the decision either way in the inventory.
- Prefer deleting repair logic over converting it where it guards against states that can no longer occur post-issue-05.

## Out of scope

- Scroll/navigation/IIIF selection side effects and the regression harness (issue 20).
- Editor feature work, schema changes, TEI mapping changes.

## Acceptance criteria

- [ ] Inventory with dispositions recorded in TRACKER.md Notes.
- [ ] `setContent` occurs only during document initialization; dev-mode enforcement in place and tested (a post-init call throws/fails in dev).
- [ ] Each converted repair has a browser-mode vitest: document in, repaired document + correctly mapped selection out.
- [ ] Typing during an autosave flush leaves the selection where typing put it (browser-mode test at the component or harness level).
- [ ] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/components/transcriptionEditor src/lib/client/transcriptionEditorStructure.spec.ts
bun run check && bun run test:unit -- --run
```

Success: editor suites pass including the new transaction-repair and enforcement tests.

## Blocked by

None - can start immediately (issue 05 is Completed).
