# Phase 11: Transcription Editor Selection Integrity

Status: Not Started
Depends on: Phase 05
Architecture reference: `architecture.md` sections 1 (audit findings), 6 (single-writer rule)

## Goal

Eliminate the "cursor jumps to a different line" class of bugs by removing every post-initialization full-document replacement and making all document mutations selection-preserving ProseMirror transactions.

## Scope

1. Audit and inventory (first task of the session): every call to `editor.commands.setContent(...)` and every structure-mutating path in:
   - `TranscriptionEditor.svelte`
   - `InlineCarrierWorkspace.svelte`
   - `transcriptionEditorStructure.ts` (`repairManuscriptStructureJson`, line splitting, generated IDs)
   - any handler reacting to `update`/`selectionUpdate` that itself dispatches changes
   Record the inventory in Notes with a disposition for each: allowed (init-only), converted to transaction, or deleted.
2. Enforce init-only `setContent`:
   - `setContent` is permitted exactly once per document load. Structure repair runs on the loaded JSON before the initial `setContent`, never on a live document.
   - Post-load structural fixes (line splitting, ID assignment) become ProseMirror transactions using position mapping (`tr.mapping`) so the selection survives; where TipTap commands suffice, use them.
3. Single-writer autosave interaction (with Phase 05 in place):
   - The autosave path must not touch editor state. `fromProseMirror` + `mergeWithCanonicalDocument` operate on `editor.getJSON()` snapshots; the in-memory canonical document is replaced only after the working-file write resolves; no code path feeds a merged document back into the editor.
   - If `mergeWithCanonicalDocument` can produce a doc differing from what the editor shows (stale canonical fields), that difference must stay outside the editor; reconcile at commit, not during typing.
4. Selection-affecting side features:
   - `scrollToVerse`, active-page tracking, and IIIF-driven navigation: scrolling must not move the selection unless the user explicitly requested a jump; audit `editorInteractions.ts` and cursor-tracking debounce for feedback loops (selection update -> state change -> effect -> selection change).
5. Regression harness:
   - Extend `/transcription/harness` with scripted scenarios: type at line end during autosave flush; type immediately after a structural element insert; correction workspace open/close; IIIF page change while typing. Assert selection stability (position delta only from typed characters).
   - Add browser-mode vitest coverage for the transaction-based repairs (doc in, doc + mapped selection out).

## Non-Goals

- Editor feature work, schema changes, or TEI mapping changes.
- The `InlineCarrierWorkspace` sub-editor may keep `setContent` for its own isolated editor instance if its selection lives only within the workspace; document the decision.

## Design Notes

- Root causes identified in the audit: (a) `setContent` after init from repair/merge paths remaps positions; (b) canonical-document mutation racing autosave; (c) selection-reactive handlers dispatching document changes. Fixing (b) lands in Phase 05; this phase completes (a) and (c) and adds the harness proving all three.
- Prefer deleting repair logic over converting it, where the repair guards against states that can no longer occur once the write path is inverted (stale merged docs were a repair driver).
- The 500ms cursor-position debounce + `selectionUpdate` handler pair is a plausible feedback loop; consider deriving the cursor display state from a single subscription with no writes back to the editor.

## Checklist

- [ ] `setContent`/mutation inventory recorded with dispositions
- [ ] `setContent` init-only, enforced (dev-mode assertion or lint rule)
- [ ] Structure repairs converted to mapped transactions or deleted
- [ ] No autosave/merge path writes into the editor
- [ ] Scroll/navigation paths leave selection untouched
- [ ] Harness scenarios + browser-mode tests passing
- [ ] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

The harness scenarios pass repeatedly (run 50x loop) with zero unexpected selection movement, and a manual editing session (typing across autosave boundaries, inserting corrections, switching pages) produces no cursor jumps.

## Verification

```bash
cd app
bun run test:unit -- --run src/lib/components/transcriptionEditor src/lib/client/transcriptionEditorStructure*
bun run check && bun run test:unit -- --run
```

## Notes

| Date | Note |
| --- | --- |
