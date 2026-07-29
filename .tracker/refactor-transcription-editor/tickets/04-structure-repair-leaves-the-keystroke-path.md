# Ticket 04: Structure repair leaves the keystroke path

## Parent

`../SPEC.md` § D2, § B.

## What to build

Typing occasionally throws the cursor back to the start of the line, and large documents are slow to edit. Both are caused by whole-document work running on every keystroke. Move that work off the edit loop so per-keystroke cost is proportional to the change rather than to document size.

This is mostly a removal ticket: the largest single item is deleting a call, not writing a faster version of it.

## Where to start

`repairManuscriptStructureJson` runs over the entire document on every keystroke, from `LineNumberNormalizer`'s `appendTransaction`. It `structuredClone`s every node, rebuilds the tree, then decides whether anything changed via `JSON.stringify(doc) !== JSON.stringify(repairedDoc)` — two full serializations per character.

| Document | Total per keystroke | Of which repair |
| --- | --- | --- |
| 100 lines | 7.5 ms | 6.9 ms |
| 250 lines | 19.3 ms | 14.1 ms |
| 500 lines | 30.3 ms | 27.6 ms |

ProseMirror's own full `doc.descendants()` scan at 500 lines measures **0.03 ms**. The engine is not the bottleneck; roughly 90% of keystroke cost is this one function, and it scales linearly.

At 500 lines that is a ~33 keystroke/second ceiling, synchronous, inside the transaction pipeline. When input outruns it, `contenteditable` and ProseMirror's `DOMObserver` desynchronise and `readDOMChange` reconciles against a stale view, landing the caret on a node boundary — the line start.

**Four changes**, in `app/src/lib/client/transcriptionEditorSchema.ts` unless noted:

1. **Repair leaves `appendTransaction`.** Structure repair is a document-entry concern. Keep `repairManuscriptStructureJson` in `app/src/lib/client/transcriptionEditorStructure.ts`; move its call sites to load (already present in `TranscriptionEditor.svelte`'s init), import, and paste. Delete `createManuscriptStructureRepairTransaction` and its full-document `tr.replaceWith(0, doc.content.size, …)` recovery — a selection mapped through a full-document replace does not come back where it started, and the step poisons undo history. If a mid-session defence is still wanted, it must be O(change) and must fail loudly rather than silently rewriting the document under the cursor.

2. **`PunctuationHighlighter` scans only changed ranges.** It currently walks every text node per keystroke. Restrict it to the transaction's step map. Note its de-duplication test is also wrong in kind — `node.marks.some(m => m.type.name === 'punctuation')` asks whether the *whole text node* carries the mark rather than the specific character — but leave that to the inventory's verdict; this ticket is about cost. If the inventory recommends moving punctuation highlighting to a decoration plugin, that is a later ticket.

3. **`LineNumberNormalizer` walks only touched columns.** Restrict it to columns intersecting the transaction's changed ranges.

4. **Component-side per-keystroke work**, in `app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte`. The `update` handler runs `editor.getJSON()`, `fromProseMirror()`, `checkForPages()` and `rebuildPageList()` synchronously on every keystroke. Serialization belongs *inside* the existing `createDebouncedAutosave` and `createDebouncedVerseIndexSync` timers, not ahead of them. Separately, `getCurrentCursorPosition()` walks the document on every selection change; derive it from `$from` ancestors instead.

Measurement harness for the acceptance criteria: mount an editor in a `client`-project spec, dispatch N `insertText` transactions, and divide. The pattern used to produce the table above is a loop over `editor.view.dispatch(editor.state.tr.insertText('α', pos, pos))` with `performance.now()` either side.

## Contract

- Per-keystroke cost does not grow with document size.
- Structure repair runs at document-entry boundaries only — load, import, and paste — and each is covered by a test.
- No plugin returns an `appendTransaction` for an ordinary text insertion.
- Autosave and verse-index sync still fire on their existing debounce intervals, and still receive equivalent documents.
- Undo after typing does not step through appended repair transactions.

## Out of scope

- Removing `lineNumber`/`columnNumber` attributes entirely. That is the real fix for item 3 and belongs to a later ticket written from ticket 01's inventory; here, only narrow the walk.
- The punctuation plugin's `setSelection` call — ticket 03 owns that.
- The punctuation de-duplication correctness bug — inventory decides.
- Virtualized scrolling. Re-measure after this ticket before reconsidering; see `../SPEC.md` § On Virtualization.

## Acceptance criteria

- [x] Measured per-keystroke cost at 100, 250 and 500 lines is flat within noise, and the 500-line figure is under 2 ms.
- [x] The measurement spec is committed under `app/src/`, and the before/after numbers are recorded in `TRACKER.md` Notes beside the baseline table above.
- [x] Typing 20 characters produces exactly 20 transactions.
- [x] `createManuscriptStructureRepairTransaction` no longer exists.
- [x] Repair still fires on load, import and paste, each covered by a test.
- [x] Net change across the touched files is a reduction in lines.
- [x] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm run check
pnpm run test:unit -- --run
git diff --stat -- src/lib/client/transcriptionEditorSchema.ts src/lib/components/transcriptionEditor/TranscriptionEditor.svelte
```

Success: the editor specs pass including the timing spec; `check` and the unit suite pass; `git diff --stat` shows more deletions than insertions across the two files.

## Blocked by

- Ticket 01 (`01-editor-code-quality-inventory.md`) — its read of `editorCommands.ts` and `packages/tei-transcription` establishes which callers depend on repair running mid-session, and its undo/redo answer (question 5) bears on removing the appended transactions.

## Implementation note

**2026-07-28 — Accepted decision.** Reference-edition seeding is removed from this ticket's contract because no application entry point exists. Ticket `04` covers the real load, import, and paste boundaries only; adding seeding remains a separate future feature.
