# Refactor Transcription Editor

## Problem Statement

The transcription editor is the application. A scholar spends hours inside it, and it currently fights them in three ways they can feel and one they cannot:

- Clicking anywhere on a line puts the cursor at the **beginning** of that line rather than where they clicked.
- Typing occasionally throws the cursor back to the start of the line.
- A framed page demands horizontal scroll long before its content warrants it, and its columns grow as if padded.
- **Pressing Enter in any multi-line column silently duplicates every other line in that column.**

The fourth was not reported. It was found by accident during this investigation and is corrupting documents right now.

Two further silent losses were found in a later pass, at the boundary where the editor's document is converted for storage and export (D5, D6). Neither was reported either, and each is reachable by a single ordinary keystroke: typing a period after a word, and pressing Enter on a blank line.

These are not a handful of unrelated bugs. They are symptoms of a small number of architectural decisions that work against ProseMirror rather than with it. The same decisions are what make large documents slow to edit — slow enough that virtualized scrolling was attempted as a workaround, which introduced its own problems and was reverted.

The purpose of this epic is to remove those decisions, not to patch the individual symptoms.

## Method

Findings below were produced in a real browser, not by reading alone. The `client` vitest project runs Playwright/Chromium, so a scratch spec under `app/src/**/*.svelte.spec.ts` can mount a real editor, apply real CSS, and measure real layout and hit-testing:

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor/<scratch>.svelte.spec.ts
```

Every number in this document came from that harness. **The Enter corruption bug was found by measurement, not by reading** — the code had already been read past without the defect being noticed. That fact should shape how the remaining work is verified: exercise the transaction builders against realistic fixtures, do not reason about them.

The point has since been made three more times. Ticket `01` found F6, F10 and F14 — all document-destroying, none reported — by *executing* ordinary user actions against a non-degenerate fixture, over code it had already read. A later audit pass found D5 and D6 the same way, at the conversion boundary. Every claim in this document and in `INVENTORY.md` that is labelled **read** rather than **executed** should be treated as a hypothesis until a spec runs it.

## Confirmed Defects

### D1 — Click anywhere on a line goes to the line's start

`app/src/lib/client/transcriptionEditorSchema.ts`, the `handleClick` prop on the `main-manuscript` profile (introduced by commit `655a97d`, "add click handling for main-manuscript profile in editor").

```js
handleClick: (view, _pos, event) => {
    const line = target?.closest('.line');
    if (!line) return false;
    const lineContent = line.querySelector('.line-content');
    if (target?.closest('.line-content') && lineContent.textContent !== '') return false;
    const lineStart = view.posAtDOM(lineContent, 0);   // always the line's start
    view.dispatch(...setSelection(TextSelection.near(resolve(lineStart))));
    return true;
}
```

Any click on a line that is not inside `.line-content` is forced to position 1 of that line. Measured on a line containing "Alpha":

| Measurement | Value |
| --- | --- |
| `<p class="line">` box width | 844 px |
| `.line-content` (the contentDOM) width | 39 px |
| Dead zone — line area outside contentDOM | **770 px** |
| `view.posAtCoords()` at the click point | **8** — end of "Alpha", correct |
| `state.selection` after the click | **3** — start of the line |

ProseMirror resolves the position correctly on its own. The handler discards that answer. It also swallows clicks on the line-number gutter and the wrapped-arrow.

The handler was evidently added to make empty lines clickable, but the guard is far too broad. The structural half of the problem is that `.line-content` does not fill the line box (see A2), so the "natural" click target — past the end of the text — is never inside the editable content.

### D2 — Cursor jumps to line start while typing

Not a selection-mapping defect. Ruled out by measurement: structure repair reports `repaired: false` both at rest and after typing; the line-number normalizer's position mapping through `setNodeMarkup` is sound; programmatic typing tracks the cursor correctly (22 → 23 → 24 → 25).

The cause is cost. `LineNumberNormalizer`'s `appendTransaction` calls `repairManuscriptStructureJson` **over the entire document on every keystroke**. That function `structuredClone`s every node, rebuilds the whole tree, then decides whether anything changed via `JSON.stringify(doc) !== JSON.stringify(repairedDoc)` — two full serializations of the manuscript, per character.

Per-keystroke cost attribution (Chromium, one column of Greek text lines):

| Document | Total per keystroke | Of which `repairManuscriptStructureJson` |
| --- | --- | --- |
| 100 lines | 7.5 ms | 6.9 ms |
| 250 lines | 19.3 ms | 14.1 ms |
| 500 lines | 30.3 ms | 27.6 ms |

For calibration, ProseMirror's own full `doc.descendants()` scan over the 500-line document measured **0.03 ms**. The engine is not the bottleneck. Roughly 90% of keystroke cost is this one function, and it scales linearly with document size.

At 500 lines that is a ~33 keystroke/second ceiling, synchronous, on the main thread, inside the transaction pipeline. When input outruns it, `contenteditable` and ProseMirror's `DOMObserver` desynchronise, and `readDOMChange` reconciles against a stale view — which lands the caret on a node boundary, i.e. the line start.

On top of that, `TranscriptionEditor.svelte`'s `update` handler runs `editor.getJSON()`, `fromProseMirror()`, `checkForPages()` and `rebuildPageList()` synchronously on every keystroke, and `getCurrentCursorPosition()` walks the document on every selection change.

Separately, when repair *does* fire it replaces the whole document (`state.tr.replaceWith(0, doc.content.size, …)`) and recovers the selection by mapping through that replace. A position mapped through a full-document replace does not come back where it started, so on that path the cursor genuinely teleports.

**Corrected by `INVENTORY.md` Q5:** this paragraph originally added "It also poisons undo history." It does not. ProseMirror folds an appended transaction into the same history event as the transaction that provoked it, so a typed character, a column split and an Enter each undo in exactly one step. The load *is* an undoable event and the first edit groups with it — but that is F14, a different defect.

**Caveat — the causal chain above is an inference, and this is the bug the scholar feels most often.** The cost is measured. The link from cost to caret jump (`DOMObserver` desync → `readDOMChange` against a stale view) is not: nobody has reproduced the jump on demand and then shown it disappears once the cost is removed. Ticket `03` should reproduce it first — an input-rate test that outruns the repair, asserting the caret — and only then remove the cost. If the jump survives, the cause is elsewhere and the performance work, though still worth doing, will not have fixed the reported bug.

### D3 — Framed page demands horizontal scroll

Two rules in `TranscriptionEditor.svelte`'s style block fight each other:

```css
:global(.page)   { min-width: fit-content; }
:global(.column) { min-width: 20rem; }
```

Measured intrinsic widths of an **empty** framed page (five zones, zero characters typed):

| Page kind | `min-content` | `max-content` |
| --- | --- | --- |
| Framed (5 zones), empty | container-dependent | **1664 px** |
| Plain (1 column), empty | 352 px | 352 px |

1664 px with no content is five columns × the 320 px `min-width` floor summed onto one hypothetical flex line. `.frame-grid` is `flex-wrap: wrap`, and a wrapping flex container's max-content size is the sum of all its items as though nothing wrapped.

Two consequences follow.

**The frame layout silently collapses below ~1100 px.** `min-width: 20rem` clamps each zone's flex base size, so left (320) + center (384) + right (320) + gaps exceeds the available width and the right column wraps onto its own full-width row. Measured visual rows:

| Container width | Rows |
| --- | --- |
| 1400 px | `top` / `left + center + right` / `bottom` — correct |
| 1200 px | `top` / `left + center + right` / `bottom` — correct |
| 1000 px | `top` / `left + center` / **`right`** / `bottom` — broken |
| 900 px | `top` / `left + center` / **`right`** / `bottom` — broken |
| 700 px and below | all five stacked |

**Corrected by `INVENTORY.md` F16.** This originally read "setting `.column { min-width: 0 }` restores the intended three-across frame at 1000 px and below." Re-measured against the app's real stylesheet, it does not — `right` still wraps. The 320 px floor is only half of it: the declared flex bases (`1 1 16rem` for `left` and `right`, `2 1 24rem` for `center`) sum to 56 rem before padding and gaps, which forces the wrap at 1000 px on its own. A fix that only removes `min-width: 20rem` will look correct at 1400 px and still be broken at 1000. Ticket `05` should replace the wrapping flex row with a layout that cannot wrap unintentionally.

**The page snaps outward nonlinearly once one column's text gets long.** At a 1200 px container, typing into the center column does nothing visible up to ~80 characters — the text simply spills, because `.page`, `.column` and `.line` are all `overflow: visible`. Then:

| Center column text | `.line-content` width | Page width | Container `scrollWidth` |
| --- | --- | --- | --- |
| empty | 1 px | 1200 | 1200 |
| 40 chars | 378 px | 1200 | 1200 |
| 80 chars | 443 px | 1200 | 1200 |
| 160 chars | 650 px | **1615** | **2016** |

The long line is 650 px wide, but the page demanded ~965 px more than the container — because `fit-content` drags all five zones' minimums along with the single column that grew. That is the reported "growing before it needs to, as if there's padding the text adds to rather than consumes".

**Caveat closed by `INVENTORY.md` F15.** This originally recorded that a completely blank framed page did not overflow at any width tested, and guessed at a narrow editor pane. The real mechanism is more specific and is one class: the editor mounts its content inside `<div class="relative flex min-w-max flex-col items-center">` (`TranscriptionEditor.svelte:1356`). `min-w-max` is `min-width: max-content`. `.page { min-width: fit-content }` cannot overflow on its own — `fit-content` clamps to available space — but that clamp is measured against the ancestor, and an ancestor sized to `max-content` offers unbounded space. Measured on a blank five-zone framed page in a 1000 px pane: overflows as shipped, does not overflow with `min-width: 0` on the editor root, and a blank *plain* page never overflows. Delete `min-w-max`; it defeats every `fit-content` and `min-width: 0` clamp beneath it.

### D4 — Enter duplicates every other line in the column

`app/src/lib/client/transcriptionEditorStructure.ts`, `createLineSplitTransaction`:

```js
const replacement = [...linesBefore, firstLine, secondLine, ...linesAfter].map(...);
const tr = state.tr.replaceWith(linePos, linePos + currentLine.nodeSize, replacement);
```

`replacement` is the **whole column's** line list. The replaced range is **only the current line**. So the entire column is re-inserted in place of one line.

Reproduced through the real Enter keybinding:

```
BEFORE: ["alpha","beta","gamma"]      cursor mid-"beta", press Enter
AFTER : ["alpha","alpha","be","ta","gamma","gamma"]
WANTED: ["alpha","be","ta","gamma"]
```

```
BEFORE: ["one","two","three","four"]  cursor mid-"three"
AFTER : ["one","two","one","two","th","ree","four","four"]
WANTED: ["one","two","th","ree","four"]
```

A single-line column is the only case that behaves correctly, because `linesBefore` and `linesAfter` are then both empty.

**The existing test passes because it uses a single-line column.** See `app/src/lib/client/transcriptionEditorStructure.svelte.spec.ts`, "splits the current line in place and keeps selection in the same column". This is the defining example of why the test fixtures in this area are inadequate (see ticket 09).

`createColumnSplitTransaction` has the same *shape* but replaces the whole column's range, so its **line handling** is correct. **Narrowed by `INVENTORY.md`:** the rest of it is not. It numbers the new column from the document-wide maximum rather than from its index within its own page (F2), drops `zone` and `teiAttrs` from the new column (F3), provokes a whole-document replace on every split because its output always fails repair (F4), and sets no target selection, so the caret lands in the following column (F37). `createEmptyLineInsertTransaction` replaces one line with exactly two lines derived from it, so it is correct — but see D6, where the line it inserts does not survive the next save.

### D5 — Typing punctuation next to a word deletes that word from the exported TEI

`packages/tei-transcription/src/tei-serializer.ts:354`, `exportWord`. Found by execution in the audit pass; `INVENTORY.md` F35 carries the full write-up.

`PunctuationHighlighter` (anti-pattern B2) marks the punctuation character in place, producing an unmarked text node immediately followed by a punctuation-marked one with no whitespace between them. `groupIntoWords` splits only on spaces, so both land in the same word group. `exportWord` then does this:

```js
const hasPunctuation = nodes.some(node => node.marks?.some(m => m.type === 'punctuation'));
if (hasPunctuation) {
    for (const node of nodes) {
        const punctuationMark = node.marks?.find(m => m.type === 'punctuation');
        if (punctuationMark) { context.xml.push(`<pc…>${escapeXml(node.text || '')}</pc>`); }
    }
    return;             // every unmarked node in the group is discarded
}
```

Executed: a group of `alpha` + marked `.` exports as `<ab><pc>.</pc></ab>`. The `<w>alpha</w>` is gone.

The existing punctuation round-trip test does not catch it because the *parser* inserts a boundary after the preceding `<w>` (`tei-parser.ts:163`) which `pm-adapter.ts:94` turns into a space — so an imported standalone `<pc>` is in its own group. Only punctuation typed **in the editor** reaches the broken shape.

This is why B2 is not merely a performance finding. The highlighter is editor code, and its output shape is what destroys the word, so this is in scope by the rule in § Scope.

### D6 — Autosave permanently deletes intentional empty lines

`packages/tei-transcription/src/normalize.ts:145`, `normalizeColumn`. Found by execution in the audit pass; `INVENTORY.md` F36 carries the full write-up.

```js
const normalizedLines = column.lines.map(normalizeLine).filter(line => line.items.length > 0);
```

`fromProseMirror` builds the lines and then calls `normalizeDocument`, which drops every line with no items. Autosave persists that normalized result as the canonical stored document, so a blank line survives only until reload:

```text
ProseMirror lines before save:  ["alpha", "", "beta", ""]
fromProseMirror result:         ["alpha", "beta"]
persisted reload:               ["alpha", "beta"]
```

An all-empty column collapses to a single empty line. This directly contradicts the editor's own behaviour: the **only** caller of `createEmptyLineInsertTransaction` is the Enter keybinding (`transcriptionEditorSchema.ts:1525`), so pressing Enter on a blank line is a first-class command whose result the save path discards. `packages/tei-transcription/tests/normalize.spec.ts:6` currently locks the lossy behaviour in, so fixing it means flipping an existing expectation, not adding one.

Blank lines are meaningful in a diplomatic transcription — a scribe's spacing, a lacuna's extent. Whether they should be preserved is a scholarly decision, not a normalizer's default, and the decision has never been made explicitly.

## Anti-Pattern Inventory

The defects above are surface expressions of the following.

### A — Selection has no single owner

Multiple places write the selection outside the transaction that caused the change:

- **A1** `handleClick` overrides ProseMirror's own hit-testing result (D1).
- **A2** Editorial chrome — the line-number gutter, the wrapped arrow — is rendered as `contenteditable="false"` siblings of the contentDOM inside `Line.renderHTML`. The contentDOM (`.line-content`) is `inline-block; min-width: 1px` and does not fill the line box, so ~90% of a typical line is not editable content. This is what makes A1 seem necessary.
- **A3** `PunctuationHighlighter`'s `appendTransaction` unconditionally calls `tr.setSelection(TextSelection.near(...))`, which silently downgrades a `NodeSelection` to a text cursor whenever the document changes.
- **A4** `restoreMappedSelection` in the repair and normalize paths re-derives the selection by mapping, including through full-document replaces.
- **A5** The `Line` node's `Enter` shortcut dispatches a transaction that already sets the selection, then schedules `queueMicrotask(() => editor.chain().focus().setTextSelection(pos).run())` on top of it — a second, asynchronous selection write.
- **A6** `handleDOMEvents` blanket-returns `true` for `mousemove`, `mouseenter`, `mouseleave`, `dragover`, `dragenter` and `dragleave`, suppressing ProseMirror's own handling of those events. Drag-selection and drop behaviour are affected.

### B — O(document) work on every keystroke

- **B1** `repairManuscriptStructureJson` in `appendTransaction` — deep clone of every node plus two full `JSON.stringify` passes. ~90% of keystroke cost (D2). Repair belongs at load/import boundaries, not in the edit loop.
- **B2** `PunctuationHighlighter` scans every text node in the document per keystroke. Its de-duplication test is also wrong in kind: `node.marks.some(m => m.type.name === 'punctuation')` asks whether the *whole text node* carries the mark, not whether the specific character does. **This is the most damaging entry under B, and not for its cost:** the split text nodes it produces are what make TEI export delete the preceding word (D5). Fixing B2 for performance alone, without changing the shape it writes into the document, leaves the data loss in place. Treat it as a correctness item that happens to also be slow.
- **B3** `LineNumberNormalizer` walks the whole document per keystroke.
- **B4** `TranscriptionEditor.svelte`'s `update` handler serialises the document (`getJSON()` + `fromProseMirror()`) and rebuilds the page list synchronously per keystroke; `getCurrentCursorPosition()` walks the document per selection change.

### C — Derived data stored as node attributes

`lineNumber` and `columnNumber` are pure functions of a node's position in its parent, but they are persisted as node attributes and reconciled by transaction.

Consequence: splitting a line renumbers every line below it. An attribute change fails `Node.sameMarkup()`, so ProseMirror destroys and rebuilds that line's entire DOM subtree. Measured DOM element churn from a **single** Enter:

| Column size | Elements created | Elements destroyed |
| --- | --- | --- |
| 50 lines | 99 | 49 |
| 150 lines | 299 | 149 |
| 300 lines | 599 | 299 |

By contrast, a plain typed character produces **zero** DOM element churn. That gap is the entire large-document performance story. Line and column numbers are presentation and should be rendered by CSS counters or decorations, with no document mutation at all.

### D — Rich content stored as JSON strings in attributes

`fw.content`, `correctionNode.corrections`, the `correction` mark's payload, and `teiAttrs` on nearly every node hold structured content serialised into DOM attributes. There are 51 `JSON.stringify` calls in `transcriptionEditorSchema.ts`.

This is what forces `InlineCarrierWorkspace.svelte` to run a **second** `Editor` instance and hand-synchronise it with the parent via `JSON.stringify` snapshot comparison and whole-sub-document replacement. Costs: no undo granularity across that content, no marks or search inside it, and a full re-render on any change.

There is a fifth cost, and it is worse than the other four: **the content is routinely destroyed.** Because it is a string rather than a document, every editing surface must parse it, re-derive a form from it, and write a whole new string back — and each one does that lossily. Measured by execution (`INVENTORY.md` F40–F42): applying the non-marginal formwork inspector replaces the `fw`'s content with `buildPlainTextFormWorkContent(textValue)` even when only metadata changed, so a header carrying a `foreign` wrapper, a line break and a correction apparatus collapses to `<fw type="header"><w>x</w></fw>`; the correction workspace rebuilds a reading from four fields and drops `rend`, `readingAttrs` and the entire `<seg>` carrier; the simple-carrier inspector replaces `teiAttrs` with only the fields its form exposes. None of this is reachable if the content lives in the document, because then there is nothing to re-serialise — the inspector edits attributes and ProseMirror owns the content.

This raises the priority of the § "Rich content leaves node attributes" work considerably. Its entry in the work breakdown says to "re-evaluate whether it is worth doing at all"; that re-evaluation now has to weigh three confirmed content-destroying write paths, not just rendering cost.

### E — No NodeViews anywhere

There is not a single `addNodeView` in the codebase. Every node renders through `renderHTML`, which by design has no incremental update path — any attribute change is a full subtree rebuild. This is upstream of A2, C and D.

### F — Document-replacing transactions and view patching

- **F1** `createLineSplitTransaction` replaces one line's range with the whole column (D4).
- **F2** Repair does `tr.replaceWith(0, doc.content.size, …)` and maps the selection through it.
- **F3** `editorContentInitialization.ts` monkey-patches `editor.view.dispatch` to enforce its init-only invariant. That belongs in the `dispatchTransaction` editor option; patching the view's method affects every downstream dispatch and is fragile against TipTap upgrades.

### G — Layout model

- **G1** `.column { min-width: 20rem }` clamps flex base sizes and breaks the frame below ~1100 px (D3).
- **G2** `.page { min-width: fit-content }` over a `flex-wrap: wrap` container makes page width the sum of all zones' max-content (D3).
- **G3** `white-space: nowrap` with `overflow: visible` at every level means a long line never scrolls locally — overflow escalates all the way to document width.
- **G4** `forcePageRender` in `TranscriptionEditor.svelte` is a leftover hook from the reverted `content-visibility` virtualization; nothing currently sets `contentVisibility`.

## On Virtualization

Virtualized scrolling was previously attempted to make large documents editable, and was reverted because of side effects. It is worth recording *why* it behaves badly here, so it is not retried prematurely.

`content-visibility` skips layout for offscreen subtrees. ProseMirror needs geometry for exactly the operations that then break: `posAtCoords` (clicking), `coordsAtPos` (scroll-into-view and bubble-menu placement), and `endOfTextblock` (arrow-key navigation). It is fundamentally in tension with `contenteditable`.

The working assumption of this epic is that **virtualization is unnecessary once B and C are fixed**: per-keystroke cost becomes O(1) rather than O(document), and ordinary typing produces no DOM churn. ProseMirror's own document scan at 500 lines was 0.03 ms. Re-measure before reconsidering virtualization.

## Target State

- ProseMirror owns cursor placement. No editor code writes the selection except the transaction that performs a user-requested move.
- Per-keystroke work is proportional to the change, not to document size. Structure repair runs at load, import and paste boundaries only.
- Line and column numbers are presentation. They are not document state and editing does not renumber anything.
- The contentDOM of a line fills the line's clickable area; editorial chrome is drawn by CSS or decorations, not by sibling elements inside the node's DOM.
- Nodes that need imperative DOM use NodeViews with real `update()` methods.
- A page's columns size and scroll independently; a long line scrolls within its column rather than widening the document.
- Structural commands are verified against multi-line, multi-column and multi-page fixtures.
- **A round trip through save and reload returns the document the scholar was looking at.** No conversion, normalization or inspector write path silently removes structure, text or TEI attributes it does not itself understand. Where a transformation is genuinely wanted — collapsing runs of blank lines, canonicalizing an attribute — it is an explicit, documented decision with a test that names it, not a `.filter()` on the save path.

## Scope

In scope: the editor schema (`app/src/lib/client/transcriptionEditorSchema.ts`), structural transactions (`transcriptionEditorStructure.ts`), the editor component and its styles (`TranscriptionEditor.svelte`), editor commands and interactions, and the nested carrier editor where it is forced by anti-pattern D.

Out of scope for this epic: the IIIF viewer internals (`triiiceratops`), collation, the TEI file format itself, and new editor features.

Changes to the TEI ↔ ProseMirror conversion package are in scope **where editor behaviour is what reaches the defect**. This line was previously read as "the conversion package is out of scope", which is wrong and cost real findings: D5 is caused by a plugin in the editor schema, D6 discards the result of an editor command, and both surface in `packages/tei-transcription`. The test is *what causes it*, not *what file it lives in*.

Round-trip defects with no editor cause — a parser that drops `<seg>` attributes, a serializer that mishandles an element-only reading — are **out of scope and are not to be quietly absorbed**. Four such findings are recorded in `INVENTORY.md` § "Referred out of this epic" so they are not lost; they want their own epic.

## What Was Not Investigated

**Superseded — read `INVENTORY.md` § "Coverage statement" instead.** The section below records the state after the *first* pass and is kept only so its blind-spot list can be checked off. Ticket `01` read most of what is listed here as "not opened", and its coverage statement is current. Two entries below are now closed: `editorCommands.ts` and `InlineCarrierWorkspace.svelte` were read in full, and the "IIIF integration's write path into the editor" blind spot turned out to be empty — `IiifWorkspace.svelte` holds no editor, view or ProseMirror reference at all, so there is no write path.

Recorded so the next session does not assume the audit was exhaustive. Roughly 2,500–3,000 of ~15,000 lines were read.

**Read fully:** `transcriptionEditorStructure.ts`, `editorInteractions.ts`, `pageFormwork.ts`, `editorContentInitialization.ts`.

**Read substantially:** the structural nodes and plugins in `transcriptionEditorSchema.ts` (Manuscript/Page/Column/Line, repair and normalizer, punctuation and selection-highlight, profile wiring); scattered sections of `TranscriptionEditor.svelte`.

**Not opened:** `editorCommands.ts` (472 lines), `EditorToolbar.svelte` (1132), `IiifWorkspace.svelte` (1681), `formworkConcepts.ts` (533), most of `InlineCarrierWorkspace.svelte` (728), `CorrectionWorkspace.svelte`, the inspector components, `packages/tei-transcription` (which owns `toProseMirror`/`fromProseMirror`, both on the autosave hot path), and roughly 60% of the schema file — all the inline atom nodes and marks.

**Known blind spots:** the command/transaction layer (ticket 02 exists to close this); TEI round-trip fidelity; undo/redo behaviour under appended transactions; the IIIF integration's write path into the editor.

## Relationship to Existing Tickets

`.tracker/files-as-database/tickets/20-editor-selection-side-effects-and-harness.md` covered cursor-jump regressions and is marked `Completed`. Its stated suspicion was a feedback loop in `editorInteractions.ts`'s cursor-position debounce. The measurements in this document **do not support that hypothesis** — the debounce is not the driver; whole-document repair on the keystroke path is. Ticket 03 of this epic supersedes it.

`.tracker/files-as-database/tickets/19-editor-init-only-setcontent.md` produced the `editorContentInitialization.ts` invariant, which this epic keeps but re-implements (F3).

## Provisional Work Breakdown (Post-Inventory)

The following are **not tickets**. They are the expected shape of the work that cannot be specified until ticket 01's inventory lands, recorded here so the analysis behind them is not re-derived. Write the real tickets from the inventory, not from this section.

### Line and column numbers become presentation

`lineNumber` and `columnNumber` are pure functions of a node's index in its parent, but they are persisted as node attributes and reconciled by transaction. An attribute change fails `Node.sameMarkup()`, so ProseMirror destroys and rebuilds the node's DOM. Measured churn from a **single** Enter:

| Column size | Elements created | Elements destroyed |
| --- | --- | --- |
| 50 lines | 99 | 49 |
| 150 lines | 299 | 149 |
| 300 lines | 599 | 299 |

A plain typed character produces **zero** DOM element churn. Renumbering is the whole difference.

Expected shape: remove both attributes; render the number from CSS counters (`counter-reset` on the column, `counter-increment` on the line, `content: counter(...)` on a pseudo-element) rather than a decoration plugin, since counters need no plugin state, no transactions and no mapping. Delete `LineNumberNormalizer`'s renumbering pass; move its `lineId`/`columnId` assignment to the document-entry boundary established by ticket 04. **Keep** `lineId`/`columnId` — they are identity, not derived, and `LINE_SPLIT_TARGET_LINE_ID_META` and `findLineStartPositionById` depend on them.

Blocked on inventory question 1: whether TEI export reads `n` from the attribute or recomputes it from position. Also unresolved — if a manuscript legitimately carries a scribe's own non-sequential line number, that is real document data needing a distinct attribute, not the display ordinal.

### Editorial chrome leaves `renderHTML`

`Line.renderHTML` emits the line-number gutter and wrapped-arrow as `contenteditable="false"` siblings of the contentDOM, and `.line-content` is `inline-block; min-width: 1px`. Nothing fills the remaining space: measured 844 px line box, 39 px contentDOM, **770 px dead zone**. `Page.renderHTML` and `Column.renderHTML` do the same at their level (page header, label badge, running title, catchword/quire footer, column label).

Expected shape: gutter and arrow become CSS pseudo-elements driven by the counter above and a `data-wrapped` attribute; `.line-content` grows to fill the line; page and column chrome become pseudo-elements driven by `data-*`, or Svelte chrome positioned outside the ProseMirror node DOM. Re-run ticket 03's click assertions afterwards — this is what removes the dead zone structurally.

Note `Page.renderHTML` computes `hasFrameZones` by iterating children at render time, but `renderHTML` is not re-run when children change, so that class is stale as soon as columns are added or removed. Fold that in.

### NodeViews where rendering must be incremental

There is not a single `addNodeView` in the codebase. Every node renders through `renderHTML`, which has no incremental update path, so any attribute change rebuilds the subtree. `transcriptionEditorSchema.ts` holds 51 `JSON.stringify` calls, most in these render paths.

Expected shape: NodeViews with real `update(node)` methods for the carrier atoms whose badges are edited through the inspector. Keep `renderHTML` as the serialization path — `parseHTML`, clipboard and `renderCorrectionContent`'s `generateHTML` all need it — and test that the two agree. Do **not** add NodeViews uniformly: start by listing which atoms actually change attributes during editing. A `teiMilestone` written once and never edited does not need one.

### Non-degenerate test fixtures

The suite exercises single-line columns, single-column pages and single-page documents. `transcriptionEditorStructure.svelte.spec.ts`'s "splits the current line in place" test builds a column with exactly one line — the only shape for which the D4 corruption cannot occur — and passes. The failure is twofold: fixtures with one of everything, and assertions scoped to the edited node rather than the whole document.

Expected shape: shared fixture builders (≥ 4-line column, multi-column plain page, five-zone framed page, multi-page document); a whole-document snapshot helper; migrate existing specs to operate on a *middle* element of a multi-element parent, keeping degenerate cases as extra coverage. `selection-stability.svelte.spec.ts` deserves particular attention — its `simulatePageTracking` and `simulateIiifPageChange` helpers re-implement editor logic inside the test, so they assert that the test's own copy is stable. Point them at real code paths or delete them.

### Rich content leaves node attributes

`fw.content`, `correctionNode.corrections`, and the `correction` mark's payload serialise structured content into DOM attributes. This is what forces `InlineCarrierWorkspace.svelte` to run a **second** `Editor` instance and hand-synchronise it by comparing `JSON.stringify` snapshots and replacing the whole sub-document. Costs: no undo granularity across that content, no marks or search inside it, full re-render on any change.

Expected shape: make `fw` a content-holding node rather than an atom with a JSON `content` attribute — the highest-value part, and doable alone. Possibly the same for correction payloads. **Keep** `teiAttrs` as an attribute: it is a flat bag of TEI attribute values, not content.

This is the largest and least certain item in the epic. It requires a one-way migration of stored documents at load, coordinated with ticket 04's repair boundary, and a byte-identical TEI round-trip over a corpus sample. Re-evaluate whether it is worth doing at all once the earlier work has made rendering incremental — decide deliberately rather than by momentum.

## Verification Baseline

Run from `app/` unless noted. Every ticket leaves this green:

```bash
pnpm run check
pnpm run test:unit -- --run
```

Editor-focused runs during development:

```bash
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm vitest run --project client src/lib/client/transcriptionEditorStructure.svelte.spec.ts
```
