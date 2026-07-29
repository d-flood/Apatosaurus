# Transcription Editor Inventory

Deliverable of ticket `01`. This is the finding list the remaining tickets of the
`refactor-transcription-editor` epic are to be written from.

`SPEC.md` remains the authority on defects **D1–D4** and anti-patterns **A–G**.
Nothing here re-derives them. Where a finding below extends or corrects a claim
in `SPEC.md`, it says so explicitly.

**Bias: removal.** Where a finding could be resolved by adding a mechanism or by
removing the thing that needed it, the verdict recommends the removal.

46 findings, `F1`–`F46`: 28 correctness, 5 performance, 13 maintainability
(including 5 pieces of dead code). Four — **F6**, **F14**, **F35** and **F36** —
are severe enough to raise ahead of the epic and are written up first.

**Revision, 2026-07-28.** A second audit pass added `F35`–`F46`, defined `F4`
(which had a tagged spec assertion but no write-up), corrected `F3` and `F5`,
corrected the scope of Q4's answer, and referred four TEI-layer findings out of
this epic. `F1`–`F34` are otherwise unchanged and their identifiers are stable.
Three of the four `SPEC.md` corrections listed at the end of this document have
now been folded into `SPEC.md` itself; the list is kept as a record of what
changed and why.

## How to read a finding

- **Identifier** — `F<n>`, stable. Later tickets cite these.
- **Evidence** — **read** (established by reading source), **executed** (a spec
  runs the code and asserts the result), or **measured** (a number, with the
  number).
- **Verdict** — delete / simplify / replace / keep, plus one line of reasoning.
- **Kind** — correctness, performance, or maintainability.

Every **executed** and **measured** finding in `F1`–`F34` is locked in by a
committed spec. The assertion that encodes a finding is tagged `DEFECT F<n>` in
the source, so a ticket that fixes one can find the expectation to flip.

**`F35`–`F46` do not yet meet that standard.** They came from a second audit
pass whose validation files were kept outside the repository and removed after
use, so the evidence behind them is reported but not reproducible. Before a
ticket is written from any of them, its spec must be committed and tagged like
the rest — otherwise the identifier promises evidence that no longer exists.
Where such a finding is labelled **read** rather than **executed**, it has not
been reproduced at all and should be treated as a hypothesis; F6, F10 and F14
are all cases where code that had been carefully *read* turned out to be
destroying documents once it was *run*.

| Spec | Project | What it covers |
| --- | --- | --- |
| `app/src/lib/client/transcriptionEditorStructuralCommands.svelte.spec.ts` | client | the hand-built structural transactions against a 3-page / 2-column / 4-line fixture |
| `app/src/lib/client/transcriptionEditorHistory.svelte.spec.ts` | client | undo/redo under appended repair and renumber transactions |
| `app/src/lib/client/transcriptionEditorRendering.svelte.spec.ts` | client | what `renderHTML` emits and whether `parseHTML` inverts it |
| `app/src/lib/components/transcriptionEditor/transcriptionEditorCommands.svelte.spec.ts` | client | page/column/line commands driven through a **mounted** `TranscriptionEditor` and its real toolbar and metadata dialog |
| `app/src/lib/components/transcriptionEditor/transcriptionEditorLayout.svelte.spec.ts` | client | page and frame-zone geometry at a constrained pane width, with the app's real CSS |
| `app/src/lib/components/transcriptionEditor/editorCommands.svelte.spec.ts` | client | every export of `editorCommands.ts` |
| `app/src/lib/components/transcriptionEditor/inlineCarrierWorkspace.svelte.spec.ts` | client | the nested carrier editor's `replaceEditorDocument` / `syncNormalizedEditorDoc` / `emitContent`, via a **mounted** `InlineCarrierWorkspace` |
| `app/src/lib/tei/teiRoundTrip.svelte.spec.ts` | client | TEI ↔ ProseMirror fidelity along the app's real export path |

---

## Raise immediately

Ticket `01` is an investigation and fixes nothing, with one stated exception:
defects as severe as ticket `02`'s. Four qualify. All four destroy a scholar's
work, all four are reachable in one click or one keystroke, and none needs any
of the epic's other work to fix.

**F35 is the worst finding in this document.** F6 and F14 are avoidable by
habit — click into the editor first, do not undo immediately after opening.
F35 is not: typing a full stop after a word is not an edge case, and the loss
is silent, deferred to export, and unnoticeable in the editor.

### F6 — "Insert Page" destroys the whole manuscript if the editor has not been clicked into

`TranscriptionEditor.svelte:822` `insertPage`, `:861` `insertFramedPage`.
**Evidence: executed.** **Kind: correctness.** **Verdict: replace.**

Both call `editor.commands.insertContent({ type: 'page', … })`. `insertContent`
inserts at `state.selection`. Until the user puts a caret in the editor, that is
whatever selection TipTap created at construction, and fitting a block `page`
node there makes ProseMirror's fitter resolve the mismatch by replacing the
entire document.

```
BEFORE: 3 pages — [['a1','a2','a3','a4']], [['b1'…],['c1'…]], [['d1'…]]
ACTION: click "Insert Page", type a name, confirm — without first clicking into the editor
AFTER : 1 page  — [['']]
WANTED: 4 pages — the original three, plus one empty page
```

With a caret placed first, both commands behave correctly (also asserted). The
failure needs only that the user's first action after opening a transcription is
"Insert Page" — an entirely ordinary thing to do.

Verdict: replace `insertContent` with an explicit `tr.insert()` at a position
derived from the document, not from the selection. A page is a top-level node;
its insert point is `doc.content.size` or the end of the page containing the
caret. It should never depend on where the selection happens to be.

### F14 — the document load sits in the undo stack, and the first edit is grouped with it

`editorContentInitialization.ts:13`, `initializeEditorContent`.
**Evidence: executed.** **Kind: correctness.** **Verdict: simplify.**

`initializeEditorContent` calls `editor.commands.setContent(content, { emitUpdate: false })`.
`emitUpdate: false` suppresses the update event; it does not keep the
transaction out of history. So:

- A freshly loaded, unedited transcription reports `editor.can().undo() === true`.
- One undo replaces the manuscript with an empty document.
- Because the history plugin groups transactions inside `newGroupDelay`, a user
  who starts typing promptly gets their **first keystroke merged into the same
  history event as the load** — so their first `Ctrl+Z` empties the manuscript
  rather than removing the character.

Redo restores it, so the loss is recoverable until the next edit clears the redo
stack. Autosave debounces at 1000 ms, and an empty document is a valid document,
so an unlucky sequence persists the empty version.

Verdict: dispatch the initial content with `addToHistory: false`. One flag.

### F35 — typing punctuation next to a word makes TEI export delete the word

`tei-serializer.ts:354` `exportWord`, reached from `transcriptionEditorSchema.ts`'s
`PunctuationHighlighter`. **Evidence: executed** (audit pass; spec not yet
committed). **Kind: correctness / data loss.** **Verdict: replace.**
Now `SPEC.md` § D5.

`PunctuationHighlighter` marks the punctuation character in place, leaving an
unmarked text node immediately followed by a punctuation-marked one with no
whitespace between them. `groupIntoWords` splits only on spaces, so both land in
one word group. `exportWord` sees *any* punctuation mark in the group, emits
only the marked nodes, and returns — discarding every unmarked node.

```json
[
  { "type": "text", "text": "alpha" },
  { "type": "text", "text": ".",
    "marks": [{ "type": "punctuation", "attrs": { "teiAttrs": {} } }] }
]
```

exports as `<ab><pc>.</pc></ab>`. The `<w>alpha</w>` is gone.

The existing punctuation round-trip test cannot see this: the parser appends a
boundary after the preceding `<w>` (`tei-parser.ts:163`) and `pm-adapter.ts:94`
turns that boundary into a space, so an *imported* standalone `<pc>` sits in its
own group. Only punctuation typed in the editor produces the broken shape —
which is why a round-trip suite that starts from TEI has never exercised it.

Verdict: `exportWord` must emit every node in the group, wrapping only the
marked ones in `<pc>`. Fix that first, because it is the data loss. Then fix the
shape B2 writes, because a word and its punctuation being separate text nodes
with no boundary is what made the serializer's assumption wrong in the first
place. **Both halves are needed** — B2 alone leaves existing documents broken,
and the serializer alone leaves the schema producing a shape nothing else in the
pipeline expects.

### F36 — autosave permanently deletes intentional empty lines

`normalize.ts:145` `normalizeColumn`, reached from `pm-adapter.ts:445`
`fromProseMirror` and `TranscriptionEditor.svelte:1064` autosave.
**Evidence: executed** (audit pass; spec not yet committed).
**Kind: correctness / persisted data loss.** **Verdict: simplify.**
Now `SPEC.md` § D6.

```js
const normalizedLines = column.lines.map(normalizeLine).filter(line => line.items.length > 0);
```

`fromProseMirror` builds the lines and then calls `normalizeDocument`. Autosave
persists the normalized result as the canonical stored document, so a blank line
is visible only until reload:

```text
ProseMirror lines before save:  ["alpha", "", "beta", ""]
fromProseMirror result:         ["alpha", "beta"]
persisted reload:               ["alpha", "beta"]
remaining stored line numbers:  [1, 3]
```

An all-empty column collapses to one empty line.

This contradicts the editor directly. The **only** caller of
`createEmptyLineInsertTransaction` is the Enter keybinding
(`transcriptionEditorSchema.ts:1525`), so inserting a blank line is a
first-class command whose result the save path throws away. Repeated Enter on a
blank line is transient in exactly the same way.

`packages/tei-transcription/tests/normalize.spec.ts:6` locks the lossy behaviour
in, so this means flipping an existing expectation rather than adding one — read
that test before changing the filter, in case it encodes a reason that was never
written down elsewhere.

Verdict: stop filtering. If runs of blank lines genuinely need collapsing
somewhere, that is a scholarly decision about diplomatic transcription — a
scribe's spacing and a lacuna's extent are both recorded by blank lines — and it
belongs at an explicit, named, tested boundary, not in a normalizer the save
path happens to call.

---

## Answers to the five questions

### Q1 — Does TEI export read `lineNumber`/`columnNumber` from attributes, or recompute them from position?

**Neither attribute is load-bearing for TEI. Both can be removed.**
**Evidence: executed** (`teiRoundTrip.svelte.spec.ts`, "question 1").

- **`lineNumber` is never written to TEI at all.** `tei-serializer.ts:140`
  emits `<lb>` with `break` and `rend` only. Every `<lb/>` in an exported
  document is free of `@n`. On import, `tei-parser.ts:437` recomputes the number
  as a positional counter (`context.currentLine += 1`, reset to 1 at each `<cb>`
  and `<pb>`), ignoring any `@n` the source carried.
- **`columnNumber` is written** — `tei-serializer.ts:131` emits
  `n: teiAttrs.n || String(columnNumber || 1)` — but the parser only trusts `@n`
  when it matches `/C(\d+)/` (`tei-parser.ts:396`). A plain `"2"`, which is
  exactly what the serializer writes, is discarded and the column is renumbered
  by position. Set a column to `columnNumber: 40`, export, re-import: it comes
  back as `1`.

So the round trip already treats both as positional. Two further facts support
removal:

- The status bar already derives the line number positionally, not from the
  attribute: `TranscriptionEditor.svelte:934` uses `resolvedFrom.index(lineDepth - 1) + 1`.
- A scribe's own non-sequential line number does survive, but as
  `teiAttrs.n` — an opaque TEI attribute, distinct from the display ordinal.
  Removing `lineNumber` does not endanger it.

**Unblocks:** removing `lineNumber` and `columnNumber` from the schema. Note
that `columnNumber` is not purely presentational today — `createColumnSplitTransaction`
reads it (F2) and `repairManuscriptStructureJson` rewrites it — so its removal
has to be sequenced with F2.

### Q2 — Do any of the six `handleDOMEvents` suppressions serve `IiifWorkspace` or the inspector drawer?

**No. Nothing in the editor's surroundings depends on them.**
**Evidence: read.**

- `IiifWorkspace.svelte` holds no reference to the editor, the view, or any
  ProseMirror API. Its entire interface is props (`transcriptionId`, `pages`,
  `activePageId`, `selectionQuote`, `restoreState`) and three callbacks
  (`onRequestPageJump`, `onViewerStateChange`, `onPopOut`). It cannot observe an
  editor DOM event whether or not ProseMirror handles it. This also closes
  `SPEC.md`'s "IIIF integration's write path into the editor" blind spot: there
  is no write path.
- No component under `transcriptionEditor/` registers a `mousemove`,
  `mouseenter`, `mouseleave`, `dragover`, `dragenter` or `dragleave` handler.
  The only mouse handlers in the directory are three `onmousedown` /
  `preventDefault` calls in `BubbleMenu.svelte` and `EditorToolbar.svelte`,
  which are about focus retention and unaffected.
- The suppressions arrived in `d52c168` ("v2 alpha commit"), a squashed import
  with no isolating history and no accompanying change that would motivate them.

**Verdict: delete all six** (`transcriptionEditorSchema.ts:2557`). *Caveat:* what
they currently break was not measured. Removal is safe on the evidence that
nothing depends on them; the ticket that removes them should assert
drag-selection and drop behaviour afterwards rather than assume it improves.

### Q3 — Does anything still set `contentVisibility`, or is `forcePageRender` fully dead?

**Fully dead.** **Evidence: read.**

`contentVisibility` / `content-visibility` / `containIntrinsicSize` appear in
exactly one place in the app source: inside `forcePageRender` itself
(`TranscriptionEditor.svelte:1161–1173`), which reads the current value, sets it,
and restores it. No stylesheet, no component and no other code assigns any of
them. Its single caller is the scroll-to-verse effect (`:1314`), where it saves
`''`, writes `visible`, and restores `''` — a no-op plus two forced style
recalculations. See also F28.

**Verdict: delete** `forcePageRender` and its call site.

### Q4 — Does the TEI round trip lose data?

**Yes — in more places than this answer originally claimed. Do not use its
positive half as a ticket assumption.** **Evidence: executed**
(`teiRoundTrip.svelte.spec.ts`, plus the audit pass).

**Corrected, 2026-07-28.** This answer read "yes, in three specific places;
structure and text are otherwise sound." The three places are real, but the
reassurance around them was wrong, and the reason is worth keeping: the
round-trip spec starts from **TEI**, imports it, and exports it again. That
shape cannot see any loss whose trigger is *editing in the editor* — which is
where most of the losses turned out to be. A TEI-first round-trip suite is not
evidence that the editor preserves what a scholar types into it.

What does hold, and was verified: page/column/line structure, word text, and
unknown TEI attributes on `<pb>`, `<cb>` and `<lb>` (carried through `teiAttrs`)
all survive an import/export cycle. Export is idempotent — a second round trip
is byte-identical to the first.

What is lost, in this epic's scope:

- **F12** — an editor-set paragraph start never reaches the TEI.
- **F13** — page-level and column-level `wrapped` cannot survive the editor schema.
- **F19** — `lacunose` and `unclear` lose their `teiAttrs` whenever they go out through HTML.
- **F35** — typing punctuation next to a word makes export delete the word.
- **F36** — autosave deletes intentional empty lines.
- **F40, F41, F42** — the correction workspace, the simple-carrier inspector and
  the formwork inspector each destroy content or attributes on Apply.

And out of scope, referred to their own epic: **R1**–**R4** (see
§ "Referred out of this epic"), covering `<seg>` flattening, element-only
correction readings, arbitrary attributes on `gap`/untranscribed carriers, and
correction marks on partial words.

The honest summary is: **structure and text survive a TEI→TEI round trip; they
do not reliably survive being edited.**

### Q5 — What is undo/redo behaviour under the current appended transactions?

**Sound for ordinary editing. The load is the problem, not the appended
transactions.** **Evidence: executed** (`transcriptionEditorHistory.svelte.spec.ts`).

The worry was that `LineNumberNormalizer`'s appended repair/renumber transactions
would fragment or poison the stack. They do not: ProseMirror folds an appended
transaction into the same history event as the transaction that provoked it. A
typed character, a column split (whose appended repair replaces the whole
document — F2) and an Enter (including its F1 corruption) each undo in exactly
one step, to exactly the prior document.

The real problem is **F14**: the initial `setContent` is itself an undoable
event, and the first edit groups with it.

This also narrows `SPEC.md` § D2's last paragraph. Repair's full-document replace
**does** move the cursor — the position is mapped through a
`replaceWith(0, size)` — but it does not poison undo history.

---

## Correctness defects

### F1 — `createLineSplitTransaction` replaces one line with the whole column

`transcriptionEditorStructure.ts:648`. **Evidence: executed.** **Kind: correctness.**
**Verdict: replace.** Already `SPEC.md` § D4; ticket `02` owns it. Reproduced
here through the real Enter keybinding on the four-line fixture so that ticket
`02` has a non-degenerate regression test:

```
BEFORE: ['a1','a2','a3','a4']    cursor mid-"a2", press Enter
AFTER : ['a1','a1','a','2','a3','a4','a3','a4']
WANTED: ['a1','a','2','a3','a4']
```

### F2 — `createColumnSplitTransaction` numbers the new column from the document-wide maximum, so every split triggers a whole-document replace

`transcriptionEditorStructure.ts:550`. **Evidence: executed.** **Kind: correctness
and performance.** **Verdict: simplify.**

`nextColumnNumber` scans **every page** for the largest `columnNumber` and adds
one. Column numbers are per page, so splitting page 1's only column in a document
whose page 2 already has columns 1 and 2 produces `[1, 3]`.

That is then corrected, at a price. `repairManuscriptStructureJson` renumbers
columns positionally, so the split's own output always fails repair's test.
`LineNumberNormalizer.appendTransaction` responds with
`tr.replaceWith(0, doc.content.size, repaired.content)` — a full-document
replacement, with the selection re-derived by mapping through it. The settled
document is correct (`[1, 2]`), so nothing looks wrong; the cost is invisible.

The spec asserts both halves: the raw transaction's `[1, 3]`, and the
post-dispatch `[1, 2]` with repair reporting nothing left to fix (F4) — which is
the evidence that the whole-document replace really ran.

Verdict: number the new column from its index within its own page. Better still,
under Q1's answer, stop storing the number at all — then the split has nothing to
compute and repair has nothing to disagree with.

### F3 — the column split drops `zone` and `teiAttrs` from the new column

`transcriptionEditorStructure.ts:568`. **Evidence: executed.** **Kind: correctness.**
**Verdict: simplify.**

`newFirstColumn` is created with `{ ...columnNode.attrs }`; `newSecondColumn` is
created with `{ columnNumber: nextColumnNumber, columnId: null }` — no spread.
Splitting the `center` zone of a framed page yields a zone-less column with an
empty `teiAttrs`, which drops out of the frame layout entirely (`.frame-grid`
positions its children by `data-zone`) and loses whatever TEI attributes the
source `<cb>` carried.

**Verdict corrected, 2026-07-28.** This originally read "spread the source
column's attributes, as the first half already does." That is not a complete fix
and, taken literally, is a wrong one:

- **`zone` must not be copied.** A framed page has five named zones and
  `.frame-grid` positions children by `data-zone`; two columns claiming `center`
  is not a repaired document, it is a differently broken one. The existing spec
  `transcriptionEditorStructure.svelte.spec.ts:160` asserts *"keeps the original
  frame-zone on the first column and leaves the new column unzoned"* — so the
  current behaviour is not merely accidental, it is pinned. A blind spread fails
  that test, and rightly.
- **Identity attributes must be cleared, not copied.** `columnId` already is.
  `teiAttrs` may carry `xml:id`, and duplicating a TEI identifier across two
  columns is its own defect.
- **Non-identity TEI attributes should be preserved.** This part of the original
  verdict stands: losing `rend` and friends is unambiguous loss.

So the finding splits in two. The attribute loss is a real defect with an
obvious fix — carry `teiAttrs` minus its identity keys. The zone question is a
**product decision that has not been made**: what does it mean to split a column
that occupies one of five fixed frame zones? Three defensible answers — refuse
the split on a zoned column, let a zone hold multiple columns, or prompt for the
new column's zone — and the code currently implements a fourth by accident.
Ticket `05` owns the frame layout and should decide it; until then, leaving the
new column unzoned is the least-wrong behaviour and the spec should keep
asserting it.

### F4 — every column split provokes a whole-document replace, invisibly

`transcriptionEditorStructure.ts:550` and `transcriptionEditorSchema.ts:1394`
`LineNumberNormalizer`. **Evidence: executed.** **Kind: performance.**
**Verdict: simplify.**

**Added, 2026-07-28.** F4 was folded into F2's write-up while drafting, but its
identifier stayed live: `transcriptionEditorStructuralCommands.svelte.spec.ts:234`
carries a `DEFECT F4` assertion. Defined here so the tag resolves. It is the
*cost* half of F2, separated because the two are fixed differently and one of
them may be fixed by deletion instead.

The split's own output is always invalid by repair's standard — repair renumbers
columns positionally, the split numbers from the document-wide maximum (F2). So
`repairManuscriptStructureJson(tr.doc).repaired` is `true` on every split, and
`LineNumberNormalizer.appendTransaction` answers with
`tr.replaceWith(0, doc.content.size, repaired.content)`.

The spec asserts both ends: repair rejects the raw transaction, and after
dispatch there is nothing left to fix. That second assertion is the evidence the
whole-document replace really ran — the settled document is correct, so nothing
looks wrong from the outside. A user splitting a column in a 500-line manuscript
pays for a full document rebuild, a full selection remap (which is what moves the
caret in F37), and complete DOM churn, and sees only a new column.

Verdict: this disappears entirely if `columnNumber` stops being stored (Q1) —
there is nothing for the split to compute and nothing for repair to disagree
with. If the attribute survives for some reason not yet known, fixing F2's
numbering closes it instead. Either way, do not "fix" it by loosening repair:
repair disagreeing with a command is the correct behaviour of a wrong command.

### F5 — `findLineStartPositionById` returns the *last* match and never stops scanning

`transcriptionEditorStructure.ts:739`. **Evidence: executed.** **Kind: correctness
and performance.** **Verdict: replace.**

```js
doc.descendants((node, pos) => {
    if (node.type.name !== 'line') return true;
    if (node.attrs?.lineId === lineId) { position = pos + 1; return false; }
    return false;
});
```

Returning `false` from a `descendants` callback stops the *descent*, not the
*walk*. Siblings keep being visited, so (a) the scan always covers the whole
document even after a hit, and (b) a later line with the same id overwrites the
result. With ids duplicated, the function returns the last match.

**Reachability corrected, 2026-07-28.** This originally said duplicate ids arise
because "`createLineSplitTransaction` copies `{ ...currentLine.attrs }` into
`firstLine` without reassigning `lineId`, and `createColumnSplitTransaction` does
the same." Both halves are wrong on inspection:

- `createLineSplitTransaction` gives `secondLine` a fresh
  `createStableEditorNodeId('line')` (`:637`), and its `.map` backfills a fresh
  id onto any line lacking one (`:645`).
- `createColumnSplitTransaction` keeps the original id only on the first half —
  which *replaces* the original — and explicitly sets the second half's
  `lineId: null` (`:541`). It creates no duplicate.

The real mechanism is **F1**. Because the line split replaces one line's range
with the whole column's line list, every sibling line is reinserted while its
original remains — and the reinserted copies carry the originals' ids. Duplicate
ids are a *consequence of the Enter corruption*, not an independent hazard.

This changes the sequencing. Fixing F1 removes the only known source of duplicate
ids, after which F5's last-match behaviour is unreachable in practice and what
remains is the wasted full-document scan. F5 is therefore **not** a prerequisite
for F1 and should be done after it, when it is a tidy-up rather than a fix. It
stays worth doing: a function that silently returns the last of several matches
is a trap for the next caller, and it is still on the Enter cursor-placement
path.

Verdict: this is the same shape as F10. Both should become one helper that stops
at the first match. F10 is the one with a user-visible consequence today.

### F7 — line and column ids do not exist until the document is first changed

`transcriptionEditorSchema.ts:1394` `LineNumberNormalizer`. **Evidence: executed.**
**Kind: correctness.** **Verdict: simplify.**

The normalizer only runs from `appendTransaction`, and `appendTransaction` only
runs on a transaction that changed the document. A document that is loaded and
never edited therefore has `lineId === null` on every line and `columnId === null`
on every column, so `findLineStartPositionById` cannot address any of it.

`TranscriptionEditor.svelte:606` papers over this by running
`repairManuscriptStructureJson(initialPm, { ensureNodeIds: true })` before
`initializeEditorContent`, so the live app is covered. Nothing else is:
`InspectorTestHarness.svelte`, `ToolbarInsertionHarness.svelte` and every
existing spec that calls `initializeEditorContent` directly start with a document
that has no identity at all — which is part of why the test fixtures in this area
have been so weak.

Verdict: assign ids at the document-entry boundary that ticket `04` establishes,
once, for every entry point — not from a transaction plugin that cannot see the
load.

### F10 — `findFirstLineInsertPos` returns the page's *last* line

`pageFormwork.ts:170`. **Evidence: executed.** **Kind: correctness.** **Verdict: replace.**

Identical mechanism to F5: `return false` after the match stops the descent, not
the walk, so `linePos` is overwritten by every subsequent line of the page.

The consequence is visible in the UI. Setting a page label, running title,
catchword or quire signature in the metadata dialog inserts the `fw` node into
the **bottom** line of the page:

```
BEFORE: page 3 = ['d1','d2','d3','d4']
ACTION: set Page label = "fol. 2r"
AFTER : ['d1','d2','d3','fol. 2rd4']
WANTED: ['d1fol. 2r','d2','d3','d4']
```

The page's own `pageLabel` attribute is set correctly, so the dialog shows the
right value and only the transcription is wrong.

Verdict: fix jointly with F5.

### F11 — the Enter handler writes the selection a second time, asynchronously

`transcriptionEditorSchema.ts:1535`. **Evidence: executed.** **Kind: correctness.**
**Verdict: delete.** `SPEC.md` § A5 records the pattern; this adds two observed
consequences.

The handler dispatches a transaction that already sets the selection, then
schedules `queueMicrotask(() => editor.chain().focus().setTextSelection(pos).run())`.
Measured: the selection observed synchronously after the dispatch differs from
the selection one microtask later. Every `selectionUpdate` subscriber — the
status bar, the inspector, `updateSelectionDerivedState` — therefore runs at
least once against a position that is about to move.

Nothing cancels the microtask. Tearing the editor down between the dispatch and
the callback throws inside `editor.chain()`; this was observed as an unhandled
`TypeError: Cannot read properties of null (reading 'chain')` during test
teardown. In the app, that is a navigation immediately after pressing Enter.

`InlineCarrierWorkspace.svelte:287` has the same pattern in `restoreSelection` —
which is dead code (F29).

Verdict: delete the microtask. The transaction can set the selection itself; it
already computes the target line.

### F12 — an editor-set paragraph start never reaches the TEI

`tei-serializer.ts:142`. **Evidence: executed.** **Kind: correctness.**
**Verdict: simplify.**

```js
rend: node.attrs?.paragraphStart ? (node.attrs?.teiAttrs?.rend || 'hang') : undefined,
```

The ProseMirror attribute is named `'paragraph-start'` — hyphenated — in the
schema (`transcriptionEditorSchema.ts:1500`) and in `toProseMirror`
(`pm-adapter.ts:45`). `fromProseMirror` reads the hyphenated form correctly
(`pm-adapter.ts:451`). Only the serializer reads `paragraphStart`, which is
always `undefined` on a ProseMirror node, so the `rend` override never fires.

A round-tripped document looks fine, because the original parse also stored
`rend="hang"` in `teiAttrs` and `mergeTeiAttrs` re-emits it. But
`toggleParagraphStart` (`TranscriptionEditor.svelte:800`) writes only
`'paragraph-start'` and never touches `teiAttrs`, so a paragraph start set in the
editor is silently dropped on export.

Verdict: one identifier. The deeper point is that the same concept has three
spellings across three layers — `paragraphStart` (`TranscriptionDocument`),
`'paragraph-start'` (ProseMirror), `rend="hang"` (TEI) — with no single place
that maps between them.

### F13 — page-level and column-level `wrapped` cannot survive the editor schema

`transcriptionEditorSchema.ts:1058` (`Page.addAttributes`), `:1167`
(`Column.addAttributes`). **Evidence: executed.** **Kind: correctness.**
**Verdict: simplify.**

A word continuing across a page or column boundary is `break="no"` in TEI. The
parser records it (`TranscriptionPage.wrapped`, `TranscriptionColumn.wrapped`),
`toProseMirror` emits it as an attribute, `fromProseMirror` reads it back, and
the serializer writes it. The one layer that does not know about it is the editor
schema: neither `Page` nor `Column` declares a `wrapped` attribute, so
ProseMirror discards it when the JSON is loaded. `Line` does declare it, so the
line-level flag survives.

Any document that passes through the editor loses page- and column-level word
continuation.

Verdict: add `wrapped` to both node types — it is real document data, not derived
— or, if the line-level flag is genuinely sufficient to reconstruct it, stop
parsing and serializing it at the other three layers. Decide deliberately; do not
leave three layers carrying a value the fourth throws away.

### F18 — `updateNodeAttrs` throws on a position past the end of the document

`editorCommands.ts:87`. **Evidence: executed.** **Kind: correctness.**
**Verdict: simplify.**

`state.doc.nodeAt(pos)` throws `RangeError: Position … outside of fragment` for a
position beyond the document, so the `if (!node) return false` guard never runs.
Every inspector passes `selectedNode.pos` — a cached absolute position — straight
into this function (`TeiNodeInspector.svelte:90`). A position captured before a
deletion that shrank the document crashes the command rather than failing
cleanly.

Verdict: clamp before the lookup, or resolve through the current selection
instead of a cached position (see F8).

### F19 — `lacunose` and `unclear` drop their `teiAttrs` on render

`transcriptionEditorSchema.ts:249` and `:292`. **Evidence: executed.**
**Kind: correctness.** **Verdict: simplify.**

```js
'data-tei-attrs': JSON.stringify(HTMLAttributes.teiAttrs || {}),
```

`HTMLAttributes` holds already-rendered attributes — the key there is
`data-tei-attrs`, never `teiAttrs` — so the expression always yields `'{}'`.
Because the explicit key is written *after* the `...HTMLAttributes` spread, it
overwrites the correct value the attribute's own `renderHTML` had produced.

Every other mark of this family gets it right by reading `mark.attrs.teiAttrs`
(`renderTeiAttrMark`, `transcriptionEditorSchema.ts:146`). Only these two hand-written
marks are wrong.

The document itself is unaffected — TEI export runs from `getJSON()`, not from
HTML — but everything that leaves through HTML loses the attributes: clipboard
copy, and `renderCorrectionContent`'s `generateHTML`, which is how correction
previews are drawn.

Verdict: read `mark.attrs.teiAttrs`, like the other five.

### F20 — `correction`, `correctionNode` and `abbreviation` mint a new id on every render

`transcriptionEditorSchema.ts:498`, `:526`, `:584`, `:615`, `:648`, `:709`.
**Evidence: executed.** **Kind: correctness.** **Verdict: replace.**

`renderHTML` falls back to `nanoid(8)` when the id attribute is null, so it is
not a function of the node: two renders of identical content produce different
HTML. The generated id is never written back to the document, so it is different
again next time, and `parseHTML` reading it back invents identity that the
document never had.

Verdict: assign the id when the node is created, not when it is drawn. `renderHTML`
must be pure.

### F21 — the `correction` and `abbreviation` marks render a block `<div>` inside `<p class="line">`

`transcriptionEditorSchema.ts:502`, `:664`, `:683`. **Evidence: executed.**
**Kind: correctness.** **Verdict: replace.**

Both inline marks wrap their content in `['div', { class: 'tooltip' }, …]` to get
a DaisyUI tooltip. A `div` is not valid inside a `p`, and it is not inline — so a
corrected or abbreviated word cannot participate in the line's inline layout,
which is exactly the layout `SPEC.md` § A2 and § G3 are about.

Verdict: render an inline element and drive the tooltip from CSS, or move the
tooltip to a decoration. This is a NodeView/decoration candidate under
`SPEC.md` § E.

### F22 — `Page.renderHTML` computes `hasFrameZones` once and never re-runs it

`transcriptionEditorSchema.ts:987`. **Evidence: executed.** **Kind: correctness.**
**Verdict: replace.** `SPEC.md`'s "Provisional Work Breakdown" predicted this;
it is now confirmed by execution.

`renderHTML` iterates the page's children to decide between `frame-grid` and
`flex gap-4`, but ProseMirror does not re-run a node's `renderHTML` when its
children change. Giving a column a `zone` updates `data-zone` on the column and
leaves the container class stale, so the frame layout does not appear until the
page is rebuilt for some unrelated reason.

Verdict: a parent cannot derive a class from its children in `renderHTML`. Drive
it from CSS on the container (`:has(> .column[data-zone])`), which needs no
document state at all.

---

## Correctness defects found in the second pass

`F37`–`F46`. None has a committed spec yet — see § "How to read a finding".
Grouped separately so that gap is visible, not because they are less real.

### F37 — the column split leaves the caret in the *following* column

`transcriptionEditorStructure.ts:575`. **Evidence: executed** (audit pass).
**Kind: correctness.** **Verdict: simplify.**

`createColumnSplitTransaction` replaces the selected column wholesale and never
sets a target selection, so ProseMirror maps the old selection to the replacement
boundary. On the multi-page fixture, a caret in page 2 column `b` line `b3` came
out in page 2 column `c` line `c1`. The appended full-document repair (F4) then
mapped it a second time, to page 3 line `d4`.

Two jumps, two causes. Removing the repair (ticket `04`) closes the second and
leaves the first, so **this survives the F2 and F4 fixes** and needs its own
change: the transaction already knows which half the selection fell into and
should set the selection itself. It is the same root as `SPEC.md` § A — a
document-replacing transaction that declines to say where the caret goes, leaving
it to position mapping.

Existing column-split specs assert document shape only, which is why this was not
caught. Whatever ticket fixes it should assert the caret, not just the columns.

### F38 — the correction and abbreviation drawers apply a draft to whatever is selected *now*

`TranscriptionEditor.svelte:288`, `:408`; `editorInteractions.ts:135`;
`InlineCarrierWorkspace.svelte:444`. **Evidence: read.** **Kind: correctness.**
**Verdict: replace.**

Opening a drawer reads the current mark but retains neither its range nor its
identity. The main editor deliberately keeps the correction and abbreviation
drawers open across text-selection changes. Apply and Remove then call `setMark`
or `unsetMark` against the *current* selection. A draft opened for selection A
can therefore be written onto selection B — and Remove can strip a mark the user
never opened.

The nested carrier workspace repeats the pattern.

Verdict: a drawer editing a mark must hold that mark's range, and either follow
it through subsequent transactions or close when it can no longer be resolved.
This is `SPEC.md` § A in the UI layer: the drawer treats "the selection" as a
stable handle on a thing, when it is a live cursor position that anything may
move.

**Evidence caveat:** read, not executed. Reproduce before ticketing — the
observed behaviour may already be masked by a drawer close somewhere on the
selection-change path.

### F39 — the verse-index debounce writes the whole document after the editor is gone

`TranscriptionEditor.svelte:651`, `:679`, `:987`; `verse-index.ts:107`.
**Evidence: executed** (audit pass). **Kind: correctness / lifecycle.**
**Verdict: simplify.**

Every mount schedules a verse-index sync. The debounce exposes no cancel and no
flush, and neither teardown branch clears its timeout. A mounted real editor,
unmounted immediately, still called `syncVerseIndexFromDocument` about 1.2 s
later.

That function is not index-only: it calls `updateTranscriptionContent` with the
captured whole document. So an unmounted component performs a full document write
and cache invalidation — and if anything else wrote to that transcription between
navigation and the timer firing, this is a stale-write window that silently
reverts it.

F24 covers the *cost* of these conversions. This is the lifecycle bug next to it,
and the two want fixing together: F24 moves the conversion inside the timer, at
which point the timer must also be cancellable.

Verdict: give the debounce `cancel()` and `flush()`, cancel on teardown, and
decide deliberately whether an unmount should flush a pending index sync or drop
it. Dropping is probably right — the next mount re-derives it.

### F40 — the correction workspace rebuilds a reading from four fields and discards the rest

`CorrectionWorkspace.svelte:90`; `tei-parser.ts:1118`; `tei-serializer.ts:768`.
**Evidence: executed** (audit pass). **Kind: correctness / data loss.**
**Verdict: replace.**

The TEI model preserves `rend`, arbitrary `readingAttrs` and arbitrary
`segmentAttrs`. The workspace loads only `hand`, `type`, `position` and content,
then writes back a newly constructed reading containing only those. An unrelated
content edit therefore deletes metadata the plain round trip preserves.

Executed: a reading with `rdg/@type="alt"`, `rend`, `source`, `resp` and a
wrapping `<seg type="margin" subtype="pagetop" n="@P1" xml:id="seg1">` exported
after Apply as `<rdg type="corr" hand="c2"><w>beta</w></rdg>`. The segment
carrier and every unexposed attribute were lost. Reachable from both correction
marks and `correctionNode`.

There is a second, independent mismatch: the workspace writes its Type and
Position controls to top-level `type` and `position`, but
`exportCorrectionReading` serializes only `readingAttrs` and `segmentAttrs`. Those
two controls therefore have **no TEI effect at all**, even on a newly created
reading with no prior metadata to preserve. That is a broken control, not a
preservation bug, and it is the cheaper half to fix.

### F41 — the simple-carrier inspector deletes unexposed TEI attributes on Apply

`SimpleCarrierInspector.svelte:74`. **Evidence: read.** **Kind: correctness /
data loss.** **Verdict: simplify.**

The break, `space`, `handShift` and `teiMilestone` branches replace `teiAttrs`
wholesale with only the fields their forms expose. These nodes otherwise admit
and round-trip arbitrary TEI attributes, so editing one visible field deletes
`facs`, `resp`, `rendition` and anything else the source carried.

The existing inspector spec only touches displayed fields, so it cannot detect
the loss — the same fixture weakness as ticket `06`'s.

Verdict: merge the form's fields into the existing `teiAttrs` rather than
replacing it. Same shape as F40 and F42; see the note below all three.

### F42 — the formwork inspector flattens rich `fw` content to plain text

`FormWorkInspector.svelte:38`, `:65`; `formworkContent.ts:8`;
`tei-parser.ts:868`. **Evidence: executed** (audit pass). **Kind: correctness /
data loss.** **Verdict: replace.**

Every non-marginal `fw` is edited through a plain text field, and Apply always
replaces content with `buildPlainTextFormWorkContent(textValue)` — even when only
metadata changed. The parser and schema both admit far more here: marks,
correction apparatus, break carriers, atoms and structured wrappers.

Executed: a header containing a `foreign` wrapper with `xml:lang`, an embedded
line break and a correction apparatus was reduced on Apply to
`<fw type="header" rend="center"><w>x</w></fw>`.

**F40, F41 and F42 are one finding wearing three hats.** Each is an editing
surface that must parse a serialised blob, build a form from part of it, and
write a whole new blob back — and each loses whatever its form does not model.
That is the fifth cost of `SPEC.md` § D, and the strongest argument yet for
moving `fw` content into the document: an inspector that edits *attributes* over
content ProseMirror owns has nothing to flatten. Fixing all three in place is
possible and worth doing if § D is deferred, but it is three implementations of a
merge that the right data model makes unnecessary.

### F43 — deleting a correction reading while editing a later one corrupts the draft target

`CorrectionWorkspace.svelte:90`, `:204`. **Evidence: read.** **Kind: correctness.**
**Verdict: simplify.**

`editingIndex` is an array index. Removing an earlier reading shifts the edited
one without decrementing the index, so Save either finds nothing and silently
discards the draft, or writes it over a *different* reading that now occupies the
stale slot. The UI leaves every reading's Edit and Remove control active while a
draft is open.

Verdict: address the draft by reading identity, not array position — or disable
Remove while a draft is open. The second is a one-line mitigation; the first is
the fix.

### F44 — a new book does not invalidate the preceding book's chapter

`editorCommands.ts:372`. **Evidence: executed** (audit pass). **Kind: correctness.**
**Verdict: simplify.**

Verse insertion asks only for the latest preceding *chapter* milestone and never
checks whether a newer *book* superseded it. With `Book Mark`, `Chapter Mark 1`,
then `Book Luke`, inserting verse 1 returned `ok` and produced
`{ book: "Mark", chapter: "1", verse: "1" }` — while `getCurrentMilestoneValues`
at the same position reported book `Luke`. The status bar and the inserted TEI
context disagree about where the caret is.

Verdict: milestone resolution must be a single backwards walk that invalidates
narrower milestones when a broader one intervenes. Note this is the same walk
F23 wants to collapse from three scans into one — fix them together, since F23
is about to rewrite exactly this code.

### F45 — reclassifying or deleting an `fw` leaves stale page chrome

`editorCommands.ts:106`; `FormWorkInspector.svelte:65`;
`transcriptionEditorSchema.ts:979`. **Evidence: read.** **Kind: correctness.**
**Verdict: replace.**

Page chrome is duplicated: once as `fw` content, once as page attributes.
Reclassifying an `fw` writes the newly classified attribute and never clears the
old one, and deleting a selected `fw` performs no page-attribute synchronisation
at all. The page then displays a label, running title, catchword or signature
that no longer matches its children, until reinitialization or reload. A page-list
rebuild does not help — it reads the already-stale attributes.

Distinct from F22, which is a stale *layout class*; this is stale *content*.

Verdict: the duplication is the defect. Page chrome should be derived from the
`fw` children rather than mirrored into page attributes — which is the same
conclusion `SPEC.md` reaches for `hasFrameZones` in F22, and for line numbers in
§ C. Three instances of one mistake: a parent caching a fact about its children.

### F46 — IIIF selection quotes always omit the page name

`editorInteractions.ts:76`. **Evidence: executed** (audit pass).
**Kind: correctness.** **Verdict: simplify.**

`getPageContextForPosition` reads `node.attrs.n`. The page schema
(`transcriptionEditorSchema.ts:1058`) and the adapter both use `pageName`; there
is no `n` attribute on `page`. So the ternary always falls through and every
selection quote carries `pageName: null`, weakening the context handed to
`IiifWorkspace`. A page with `pageName: "folio 1r"` produced a quote with correct
text, page id and order, and a null name.

Verdict: read `pageName`. One identifier — the same class of bug as F12, and the
second time in this inventory that a field has been read under a name nothing
writes.

---

## Performance

`SPEC.md` § B established that `repairManuscriptStructureJson` is ~90% of
per-keystroke cost. The findings below are the remaining 10% plus what runs
outside the transaction pipeline. None of them is the bottleneck today; all of
them will be once B1 is fixed, and all are removable rather than optimisable.

### F23 — six full-document scans per selection change, four of them avoidable outright

`TranscriptionEditor.svelte:895` `getCurrentCursorPosition`, `editorCommands.ts:352`
`findPrecedingMilestoneNode`, `:372` `getCurrentMilestoneValues`.
**Evidence: read.** **Kind: performance.** **Verdict: simplify.**

`updateSelectionDerivedState` runs on **every** `update` *and* every
`selectionUpdate`. It calls `getCurrentCursorPosition`, which performs:

| Scan | Purpose | Avoidable? |
| --- | --- | --- |
| `nodesBetween(0, from)` | find the containing page | yes — it is an ancestor |
| `nodesBetween(0, from)` | find the containing column | yes — it is an ancestor |
| `nodesBetween(0, from)` | preceding `book` | no, but one walk could serve all three |
| `nodesBetween(0, from)` | preceding `chapter` | " |
| `nodesBetween(0, from)` | preceding `verse` | " |
| — | line number | already O(depth) |

The page and column are **ancestors of the cursor** and available in O(depth) from
`selection.$from`. The same function already does exactly that for the line
(`:926`). The three milestone scans are genuinely backwards searches, but they are
three separate front-to-back walks where one would do — and
`findPrecedingMilestoneNode`'s `if (!foundNode || pos > foundNode.pos)` guard is
dead weight, since `nodesBetween` already visits in document order.

`SPEC.md` § B4 recorded this as "`getCurrentCursorPosition()` walks the document
on every selection change". It walks it five times, on every selection change and
every keystroke.

### F24 — `fromProseMirror` runs twice per keystroke, inside two functions named "debounced"

`TranscriptionEditor.svelte:987` `createDebouncedVerseIndexSync`, `:1064`
`createDebouncedAutosave.schedule`. **Evidence: read.** **Kind: performance.**
**Verdict: simplify.**

Both helpers call `coerceEditorJsonToDocument(editorJson)` — which runs
`fromProseMirror()` over the whole document plus `normalizeDocument()` —
**before** setting the timer. Only the network write is debounced. The
conversion, the expensive part, runs synchronously on every keystroke, in both
helpers, from the same `update` handler.

Per keystroke, on the `update` path alone (`:625`):

- `editor.getJSON()` — full document serialize, once
- `fromProseMirror()` + `normalizeDocument()` — full document convert, **twice**
- `checkForPages()` — full document scan
- `rebuildPageList()` — full document scan, whenever the IIIF workspace is open
  or `onPagesChange` is supplied
- then `updateSelectionDerivedState` and its five scans (F23)

Verdict: move `coerceEditorJsonToDocument` inside the timer callback. Two lines.

### F25 — the nested carrier editor re-implements B1 at its own scale

`InlineCarrierWorkspace.svelte:166` `syncNormalizedEditorDoc`, `:321`
`replaceEditorDocument`, `:159` `emitContent`. **Evidence: executed** (behaviour)
**and read** (cost). **Kind: performance.** **Verdict: replace.**

All three behave correctly on a two-column, three-line marginalia document:
splitting a column produces `[['a1','a2'], ['','a3'], ['b1','b2','b3']]` with both
halves renumbered, toggling `wrapped` touches exactly one line, and a document
that arrives with wrong numbers is renumbered before the editor is built. The
finding is about how, not whether.

`syncNormalizedEditorDoc` runs on every `update` of the nested editor and does
`getJSON()`, a full `renumberMarginaliaDoc()` rebuild, and **two full
`JSON.stringify` passes** to decide whether anything changed — the same
compare-by-serialising shape as `repairManuscriptStructureJson`, in a second
place. When it differs, `replaceEditorDocument` does
`replaceWith(0, doc.content.size, …)` and re-derives the selection by index scan.

Every structural action in the nested editor (`splitIntoNewColumn`,
`toggleWordWrapped`, full-line untranscribed) goes through the same
whole-document replacement. `replaceEditorDocument` even sets
`allowFullDocumentReplacement` to bypass the init-only guard that ticket
`19` of the `files-as-database` epic installed.

The renumbering is also duplicated: `LineNumberNormalizer` is in the shared
extension list, so it already renumbers `marginaliaColumn`/`marginaliaLine` from
`appendTransaction`. `renumberMarginaliaDoc` does it again, from outside.

One structural consequence, discovered while building the spec and worth knowing
before touching this file: the workspace is a **controlled component whose only
guard is a string comparison**. Its `$effect` at `:598` pushes `initialContent`
back into the editor whenever
`JSON.stringify(serializeContent(cloneContent(initialContent))) !== lastSnapshot`.
So a parent that does not echo every `onChange` straight back watches the
workspace revert its own view one tick after a structural command — the change is
emitted upward *and* undone locally. The real parents (`FormWorkInspector`,
`CorrectionWorkspace`) do close the loop, so this is not a live defect, but the
correctness of the nested editor rests entirely on every future parent doing the
same, enforced by nothing.

Verdict: whatever ticket `04` does about the repair boundary must cover this file
too. It is the same anti-pattern, not a separate one. Making `fw` a
content-holding node (`SPEC.md` § D) removes the second editor and this whole
mechanism with it — which is the strongest argument yet for doing it.

### F26 — `syncPageFormWorkToContainingPage` finds the containing page by scanning from position 0

`editorCommands.ts:125`. **Evidence: executed** (behaviour correct; cost is read).
**Kind: performance.** **Verdict: simplify.** The containing page is an ancestor:
`state.doc.resolve(pos)` and walk up. Behaviour is right — the spec confirms the
label lands on the correct page of three — only the method is wrong.

### F27 — the toolbar subscribes to both `selectionUpdate` and `transaction`

`EditorToolbar.svelte:201–202`. **Evidence: read.** **Kind: performance.**
**Verdict: simplify.** `transaction` is a superset of `selectionUpdate`, so
`syncMetamarkContext` runs twice for every selection change and once for every
keystroke. It is cheap (`getMetamarkInsertContext` scans only the selection
range), but it is on the keystroke path for no reason.

---

## Dead code

### F28 — `forcePageRender`

`TranscriptionEditor.svelte:1161`, called at `:1314`. **Evidence: read.**
**Kind: maintainability.** **Verdict: delete.** See Q3. 13 lines plus the call
site.

### F29 — `restoreSelection` and `findLineStartPosition` in `InlineCarrierWorkspace`

`InlineCarrierWorkspace.svelte:260–295`. **Evidence: read.** **Kind: maintainability.**
**Verdict: delete.** Defined, never called. `findLineStartPosition` is a
near-duplicate of `findLineStartPositionInDoc` (`:340`), which *is* used;
`restoreSelection` is a second copy of the F11 microtask pattern. 36 lines.

### F30 — three unused exports in `tei-inspector-utils.ts`

`parseJsonObject` (`:1`), `prettyJson` (`:16`), `humanizeAttrKey` (`:208`) with
its `ATTR_KEY_LABELS` table (`:175`). **Evidence: read.** **Kind: maintainability.**
**Verdict: delete.** Each appears exactly once in the codebase: its own
definition. ~40 lines.

Also over-exported but internally used, so merely narrowable:
`extractTextChildrenFromNodes`, `formworkContent.isStructuredFormWorkContent`,
`pageFormwork.getPageChromeAttrs`, `editorInteractions.getSelectionRange`.

### F34 — `insertBreakNode` has no callers and would not work if it did

`editorCommands.ts:338`. **Evidence: executed.** **Kind: maintainability.**
**Verdict: delete.**

Nothing in the codebase calls it. It is also incapable of doing its job in the
main editor: `pageBreak`, `lineBreak` and `columnBreak` exist in the schema but
are absent from `MAIN_LINE_CONTENT_NODES`, so `line` does not admit them. They
appear only in `CORRECTION_INLINE_CONTENT_NODES`, i.e. inside carrier content.
Called on the manuscript profile, `insertContent` drops the node silently and the
function returns `true` anyway.

Verdict: delete. If inline break markers are ever wanted in the main editor, that
is a schema decision, not a command.

### F31 — the six `handleDOMEvents` suppressions

`transcriptionEditorSchema.ts:2557`. **Evidence: read.** **Kind: maintainability.**
**Verdict: delete.** See Q2. `SPEC.md` § A6.

---

## Layout

### F15 — the blank framed page overflows because of `min-w-max` on the editor root, not because of the page

`TranscriptionEditor.svelte:1356`. **Evidence: measured.** **Kind: correctness.**
**Verdict: delete.** **This closes `SPEC.md` § D3's open caveat.**

`SPEC.md` could not reproduce the reported blank-page horizontal scroll and
suspected a narrow editor pane. The mechanism is more specific. The editor mounts
its content inside:

```html
<div class="relative flex min-w-max flex-col items-center">
```

`min-w-max` is `min-width: max-content`. `.page { min-width: fit-content }` cannot
overflow on its own — `fit-content` clamps to the space available — but that
clamp is measured against the ancestor, and an ancestor sized to `max-content`
offers unbounded space. Measured, with the app's real stylesheet, on a blank
five-zone framed page in a 1000 px pane:

| Condition | Pane `scrollWidth` | Pane `clientWidth` |
| --- | --- | --- |
| as shipped | > 1000 (overflows) | 1000 |
| `min-width: 0` on the editor root | 1000 | 1000 |
| blank *plain* page, as shipped | 1000 | 1000 |

So: blank framed page overflows, blank plain page does not, and neutralising one
Tailwind class on one wrapper removes the overflow entirely. That matches the
original report — the frame layout is the catena view, and `SPEC.md` measured its
intrinsic demand at 1664 px.

Verdict: delete `min-w-max`. It defeats every `fit-content` and `min-width: 0`
clamp beneath it, and nothing in the epic's target state wants the editor sized
to its content.

*Method note:* the `client` vitest project does **not** load `app.css`
automatically, so a mounted component gets the Svelte `<style>` block's
`:global` rules but no Tailwind utilities. `transcriptionEditorLayout.svelte.spec.ts`
injects `app.css?inline` in `beforeAll`. Any future layout measurement must do
the same or its numbers are meaningless.

### F16 — the three-across frame needs more than `.column { min-width: 0 }` to survive 1000 px

`TranscriptionEditor.svelte:1511` and `:1704–1711`. **Evidence: measured.**
**Kind: correctness.** **Verdict: replace.** **This corrects a claim in `SPEC.md` § D3.**

`SPEC.md` states that "setting `.column { min-width: 0 }` restores the intended
three-across frame at 1000 px and below". Measured with the real stylesheet and
`min-w-max` already neutralised, it does not:

| Container | `.column` min-width | `left`/`center`/`right` on one row? |
| --- | --- | --- |
| 1400 px | 320 px (as shipped) | yes — 3 visual rows, correct |
| 1000 px | 320 px (as shipped) | no — `right` wraps, 4 visual rows |
| 1000 px | 0 | **still no** — `right` still wraps |

The `320 px` floor is only half of it. The declared flex bases —
`1 1 16rem` for `left` and `right`, `2 1 24rem` for `center` — sum to 56 rem
(896 px) before the page's padding and the grid's gaps, which is enough to force a
wrap at 1000 px on its own.

Verdict: a fix that only removes `min-width: 20rem` will look like it worked at
1400 px and still be broken at 1000. Ticket `05` should replace the wrapping flex
row with a layout that cannot wrap unintentionally — CSS grid with named zone
areas expresses the five-zone frame directly and has no `flex-wrap` to misfire.

---

## Maintainability

### F8 — page commands address pages by cached absolute position

`TranscriptionEditor.svelte:134` (`pages`), `:437` `updatePageName`, `:458`
`deletePage`, `:476` `updatePageFormWork`; `TranscriptionMetadataDialog.svelte`.
**Evidence: executed** (behaviour correct today). **Kind: maintainability.**
**Verdict: replace.**

`pages` caches `{ pos, pageId, … }` and is rebuilt only when the metadata dialog
fires `toggle`, when the drawer opens, or when the IIIF workspace is open.
Nothing remaps those positions through intervening transactions, and every page
command takes one as its argument.

This is **not** a live defect, and the reason is worth recording so a later
ticket does not assume it can be relaxed: the metadata dialog is a true modal
(`dialog.showModal()`), so while it is open the editor is inert and no
transaction can shift a position. The spec asserts exactly that — the dialog is
`:modal`, and the page commands operate correctly.

Verdict: address pages by `pageId`, not by position. The ids already exist and
are stable; the position is the thing being recomputed. It removes the invisible
dependency on the dialog's modality, and it is what F18 needs too.

### F9 — `EmptyLineTextInputStabilizer` is an unexplained workaround on the input path

`transcriptionEditorSchema.ts:1354`. **Evidence: read.** **Kind: maintainability.**
**Verdict: replace.**

A plugin that intercepts `handleTextInput` whenever the containing line is empty,
dispatches its own `insertText` transaction, sets the selection itself, and
returns `true` to suppress ProseMirror's own handling. There is no comment and no
linked issue. The name says what it does, not why.

It is a third writer of the selection outside the causing transaction
(`SPEC.md` § A), on the hottest path there is, guarding a case — typing the first
character into an empty line — that ProseMirror handles natively.

Verdict: the epic should establish what it was working around, then delete it.
The most likely answer is that it compensates for the F1/F7 line-identity
problems, in which case it goes away with them. Do not carry it forward
unexamined.

### F17 — one control silently picks between two different TEI constructs

`editorCommands.ts:274` `insertMetamarkForSelection`. **Evidence: executed.**
**Kind: maintainability.** **Verdict: replace — and specifically NOT by deleting
either representation.**

The same toolbar control produces a different document depending on what happens
to be selected:

- over a text selection — a `teiSpan` **mark** with `tag: 'metamark'`
- over a selected `editorialAction` — a `metamark` **node**

The tempting reading is "two representations of one thing, collapse them". That
is wrong, and the epic's removal bias must not be allowed to reach this one.
They serialize to different TEI, and both are correct TEI meaning different
things:

| Insert path | TEI emitted | What it means |
| --- | --- | --- |
| text selection → `teiSpan` mark | `<metamark …>the text</metamark>` | the metamark *contains* this text |
| editorial action → `metamark` node | `<metamark … target="#mod1"/>` (`tei-serializer.ts:1052`) | a standalone scribal symbol *pointing at* something else |

A marginal symbol referring to a transposition elsewhere on the page is the
standalone form and has no text to wrap. Deleting the node would make that
unrecordable; deleting the mark would make an inline metamark span unrecordable.
Both are real scholarly content.

The actual defect is that **the scholar never chooses** — the editor infers which
TEI construct to emit from the incidental shape of the selection, and nothing
downstream reconciles the two, so whether a metamark is findable or editable
depends on how it happened to be inserted.

Verdict: keep both representations; make the choice explicit in the UI, and give
the inspector a single view that can edit either. This is a *feature* gap
surfacing as an inconsistency, not redundancy to be removed.

### F32 — every inspector re-syncs its draft by comparing `JSON.stringify` snapshots

`TeiAtomInspector.svelte:25`, `TeiWrapperInspector.svelte:28`,
`SimpleCarrierInspector.svelte:37`, `MetamarkInspector.svelte:19`,
`EditorialActionInspector.svelte:23`. **Evidence: read.** **Kind: maintainability.**
**Verdict: replace.**

Five components independently implement "has the selected node changed?" as
`JSON.stringify(attrs) !== lastSnapshot`. `InlineCarrierWorkspace.svelte:598`
does the same for its whole document. This is `SPEC.md` § D's cost surfacing in
the UI layer: because the content lives in an attribute rather than in the
document, there is no cheap identity to compare, so everything compares strings.

Verdict: this is downstream of § D and should be re-evaluated after it, not
before. Recorded so the count is known: six sites.

### F33 — two extensions named `doc`, and a profile switch with no default

`transcriptionEditorSchema.ts:2284` (`InlineCarrierDocument`), `:2290`
(`MarginaliaDocument`), `:2493` `getProfileExtensions`. **Evidence: read.**
**Kind: maintainability.** **Verdict: simplify.**

`InlineCarrierDocument` and `MarginaliaDocument` are two different
`Node.create({ name: 'doc', topNode: true })` extensions with the same name. They
are never used together, so nothing breaks, but the collision is invisible until
it isn't. `getProfileExtensions` has no `else` and returns `undefined` for an
unrecognised profile, which would fail deep inside TipTap's constructor rather
than at the call site.

---

## Referred out of this epic

Four findings from the second audit pass are **real and unfixed**, but their
cause is inside `packages/tei-transcription` with no editor behaviour reaching
them. `SPEC.md` § Scope draws the line at *what causes it*, not what file it
lives in — F35 and F36 are in scope precisely because editor code produces the
shape that breaks them, and these four are not.

They are recorded here in full rather than referenced, because the document they
came from is being deleted. They want their own epic; identifiers are `R1`–`R4`
so nothing confuses them with this epic's `F<n>` numbering.

**None of these should be absorbed into a transcription-editor ticket.** An epic
whose thesis is "remove decisions that work against ProseMirror" loses its shape
if TEI parser bugs are folded into it, and they will be prioritised badly against
the editor work.

### R1 — a correction mark on part of a word deletes the whole word on export

`tei-serializer.ts:354`, `:424`. **Evidence: read. Not reproduced.**
**Kind: correctness / data loss.**

`exportWord` detects a correction mark on *any* node in a whitespace-delimited
group, then `exportCorrection` reads the mark from `nodes[0]` only. Marking a
suffix or a middle span leaves the first fragment unmarked, so `exportCorrection`
returns without emitting either the original or the corrected word — the whole
word disappears.

A correction spanning multiple words has the mirrored error: the same apparatus
is emitted independently for every word group. The selection UI permits both
partial-word and multi-word ranges; existing fixtures cover only whole single
words.

**This is the one to execute first.** It is the same shape as F35 — a
`some()` guard followed by a narrower emit — and if it reproduces, it is a
one-keystroke data loss that belongs in "Raise immediately", scope
notwithstanding. It is filed here only because it is currently **read**, not
executed, and because the fix is entirely serializer-side.

### R2 — `<seg>` handling silently loses wrappers and sibling content

`tei-parser.ts:225`, `:936`, `:1708`. **Evidence: executed** (audit pass).
**Kind: correctness / data loss.**

Two lossy branches:

- A generic segment with no immediate `fw` is unwrapped without applying a
  `teiSpan` mark, so the `<seg>` and all its attributes vanish:
  `<seg type="rubric" cert="high"><w>alpha</w></seg>` → `<w>alpha</w>`.
- A segment with any immediate `fw` keeps *only* immediate `fw` children; every
  non-`fw` sibling is discarded:
  `<seg type="margin"><fw place="left"><w>note</w></fw><w>alpha</w></seg>` loses
  `alpha`.

The model and serializer can represent a `teiSpan` whose tag is `seg`, and the
parser does not reject the input as unsupported — so this is not an explicit
unsupported-input policy, it is silent flattening.

### R3 — element-only original readings are mistaken for empty readings

`tei-parser.ts:621`, `:1327`; `tei-serializer.ts:448`. **Evidence: executed**
(audit pass). **Kind: correctness / data loss.**

`hasReadingContent` decides whether an original reading exists using only
`rdg.textContent.trim()`. An original containing just an atom — `<gap>`,
`<space>`, `<milestone>` — is classified empty and replaced by `correctionOnly`:

```xml
<rdg type="orig"><gap reason="lost" unit="chars" extent="3"/></rdg>
<!-- becomes -->
<rdg type="orig" hand="firsthand"/>
```

"The original reading was a three-character lacuna" and "there was no original
reading" are different scholarly claims. The gap is deleted.

### R4 — dedicated `gap` and untranscribed carriers discard unknown TEI attributes

`tei-parser.ts:1402`, `:1504`; `types.ts:104`; `tei-serializer.ts:179`.
**Evidence: executed** (audit pass). **Kind: correctness / data loss.**

These models project only their displayed fields instead of carrying an attribute
bag, so `<gap reason="lost" unit="chars" extent="2" cert="low" xml:id="g1"/>`
loses `cert` and `xml:id`, and an untranscribed `<note>` loses `resp`, `cert` and
`xml:id`. The `reason`/`extent` → `subtype`/`n` canonicalization is intentional;
the dropped arbitrary attributes are not.

Note the contrast with `<pb>`, `<cb>` and `<lb>`, which *do* carry a `teiAttrs`
bag and survive (Q4). The fix is to make these carriers consistent with those.

## Coverage statement

What this document does and does not cover. Sizes are lines as of 2026-07-28.

### Read in full for this ticket

| File | Lines |
| --- | --- |
| `app/src/lib/client/transcriptionEditorSchema.ts` | 2635 |
| `app/src/lib/client/transcriptionEditorStructure.ts` | 753 |
| `app/src/lib/client/editorContentInitialization.ts` | 31 |
| `app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte` | 1712 |
| `app/src/lib/components/transcriptionEditor/InlineCarrierWorkspace.svelte` | 728 |
| `app/src/lib/components/transcriptionEditor/editorCommands.ts` | 472 |
| `app/src/lib/components/transcriptionEditor/tei-inspector-utils.ts` | 223 |
| `packages/tei-transcription/src/pm-adapter.ts` (structural half) | 858 |

Plus, from `SPEC.md`'s own "read fully" list and not re-read here:
`editorInteractions.ts`, `pageFormwork.ts`.

### Read in the regions that matter, not end to end

| File | Lines | What was read |
| --- | --- | --- |
| `packages/tei-transcription/src/tei-serializer.ts` | 1111 | the `pb`/`cb`/`lb` export path, `mergeTeiAttrs`, `extractTeiAttrs`, the entry points |
| `packages/tei-transcription/src/tei-parser.ts` | 1906 | page/column/line break handling, the flush functions, `collectAttributes` |
| `app/src/lib/components/transcriptionEditor/EditorToolbar.svelte` | 1132 | the script block's state and effects, and the insert-page / insert-column / untranscribed / word-wrap / paragraph-start controls |
| `app/src/lib/components/transcriptionEditor/TranscriptionMetadataDialog.svelte` | 464 | the page-metadata section and its handlers |

### Surveyed, not read

| File | Lines | Basis |
| --- | --- | --- |
| `app/src/lib/components/transcriptionEditor/IiifWorkspace.svelte` | 1681 | Established by search that it holds no editor, view or ProseMirror reference and registers no mouse or drag handler — which is what questions 2 and 5's blind spot needed. Its IIIF manifest/canvas linking logic is out of the epic's scope and was not read. |
| the inspector components (`TeiNodeInspector`, `TeiAtomInspector`, `TeiWrapperInspector`, `SimpleCarrierInspector`, `FormWorkInspector`, `MetamarkInspector`, `EditorialActionInspector`, `CorrectionNodeInspector`, `InspectorHost`) | ~950 total | Surveyed for the epic's signatures: how they update the document (all via `onUpdateNodeAttrs(selectedNode.pos, …)` — F18) and how they sync drafts (all via `JSON.stringify` snapshots — F32). Their per-tag form layout was not read. |
| `app/src/lib/components/transcriptionEditor/formworkConcepts.ts` | 533 | Exports surveyed. It is one large `classifyFormWork` plus type unions; it performs no document mutation and holds no selection or performance surface. |
| `app/src/lib/components/transcriptionEditor/CorrectionWorkspace.svelte` | 245 | Its role as an `InlineCarrierWorkspace` host was established, and that host contract is exercised by `inlineCarrierWorkspace.svelte.spec.ts`; its own body was not read. |
| `app/src/lib/client/transcriptionEditorBadgeIcons.ts` | 206 | A single `badgeIconSpec(name, size)` over a static icon table. No behaviour. |
| `packages/tei-transcription/src/*` other than the four above | ~2100 | Inline-item, header, msDesc and tree modules. Covered behaviourally by the round-trip spec, not read. |

### Not covered at all

- `triiiceratops`, collation, and the TEI file format — out of scope by the ticket.
- The **effect** of removing the `handleDOMEvents` suppressions (F31). Their
  redundancy is established; what they currently break is not measured.
- Per-keystroke cost attribution for F23–F27. The scan counts are read off the
  source and are exact; no new timings were taken. `SPEC.md` § B's measurements
  stand and are not re-derived.
- Clipboard copy/paste behaviour, beyond the `renderHTML`/`parseHTML` asymmetries
  in F19–F21.

### What this inventory does not establish

Three limits, stated so no ticket is written as though they were closed.

**1. D2's causal chain is still an inference, and it is the bug the scholar feels
most often.** `SPEC.md` § D2 argues: whole-document repair per keystroke → main
thread blocked → `contenteditable` and ProseMirror's `DOMObserver` desynchronise
→ `readDOMChange` reconciles against a stale view → caret lands on a node
boundary. The cost is measured (6.9–27.6 ms/keystroke, ~90% of the total). The
*link from cost to the caret jump* is not. Nobody has reproduced the jump on
demand and then shown that it disappears when the cost is removed.

Everything else in this document was found by execution, and the two most severe
findings (F6, F14) were found by executing code that had already been read past.
The same standard has not been met here. Ticket `03` should reproduce the jump
first — an input-rate test that outruns the repair, asserting the caret — and
only then remove the cost, so the fix is verified against the symptom rather than
against the theory. If the jump survives, the cause is elsewhere and the
performance work, though still worth doing, will not have fixed the reported bug.

**2. The finding list is not proven complete — and this has now been
demonstrated, not just asserted.** This point originally predicted that "the
areas most likely to hide more are the inspector write paths and clipboard
behaviour." A second audit pass looked at the inspector write paths and found
four more document-damaging defects there (F40, F41, F42, F43), plus two silent
data losses on the save and export paths (F35, F36) and four TEI-layer losses
(R1–R4).

That is twelve further findings after a pass that had already read
`transcriptionEditorSchema.ts`, `TranscriptionEditor.svelte` and
`editorCommands.ts` end to end. Draw the correct conclusion: the rate of
discovery has not fallen off, so the space is still not exhausted. **Clipboard
behaviour remains unexamined** and is now the largest untouched surface that
mutates documents — it was named in this prediction and has still not been
looked at.

The second pass also confirms the method. Every one of its executed findings came
from *running* code that a previous pass had read; none came from reading more
carefully.

**3. Two verdicts recommend deleting something whose original purpose is
unknown.** F31 (the six `handleDOMEvents` suppressions) and F9
(`EmptyLineTextInputStabilizer`) are both "nothing depends on this" rather than
"we know why it was added and the reason is gone". They arrived in a squashed
commit with no explanation. Neither should be deleted blind: establish what
behaviour each was compensating for, assert that behaviour, then remove. If that
cannot be established, keep them and write down that they are unexplained —
which is still better than the present state, where they are unexplained *and*
unremarked.

### Removal discipline

The epic's bias is removal, and that bias is a hazard as well as a guide. The
test applied to every verdict here: *would a scholar be able to record something
before this change that they cannot record after?* Where the answer is yes, the
verdict is not "delete", whatever the code-size argument says.

- **F17** originally read "pick one representation; the mark is cheaper to keep."
  That was wrong and has been rewritten. The two representations emit different
  TEI and describe different scribal phenomena; deleting either makes real
  manuscript content unrecordable. Recorded here because it is exactly the
  mistake this bias produces.
- **F13** (`wrapped` on page and column) is left as an explicit either/or —
  restore it in the schema, or stop parsing it in three other layers — precisely
  so that the cheaper branch is not taken by default. It is real document data
  about word continuation across a page boundary.
- **Removing `lineNumber` and `columnNumber`** (Q1) costs nothing, and this was
  checked rather than assumed: no UI anywhere writes a line number, the status
  bar already derives it positionally (`TranscriptionEditor.svelte:934`), and
  `LineNumberNormalizer` overwrites any custom value on the next edit, so a
  non-sequential number cannot survive today in any case. Note the corollary,
  which is a **pre-existing gap and not a consequence of the change**: a scholar
  currently has no way to record a scribe's own non-sequential line numbering.
  The TEI layer can carry it (`teiAttrs.n`, preserved on import); nothing in the
  UI exposes it. Worth a ticket in its own right.
- Everything under **Dead code** (F28, F29, F30, F31, F34) is unreachable or
  uncalled. F34's `insertBreakNode` is the clearest case: no callers, and the
  `line` content expression would reject its output anyway.

### Corrections to `SPEC.md`

All four have been folded into `SPEC.md` itself as of 2026-07-28, each marked
inline at the claim it replaces. Kept here as the record of what changed.

- § D3's open caveat is **closed** — see F15. The cause is `min-w-max` on the
  editor root.
- § D3's claim that `.column { min-width: 0 }` restores the three-across frame at
  1000 px is **not reproduced** — see F16. The flex bases force the wrap too.
- § D2's "It also poisons undo history" is **not supported** — see Q5. Repair's
  full-document replace does move the cursor, but appended transactions fold into
  the same history event and undo correctly.
- § D4's note that `createColumnSplitTransaction` "is correct" is **narrowed** —
  its line handling is correct; its column numbering (F2), attribute handling
  (F3), repair churn (F4) and caret placement (F37) are not.

### Corrections to this document

Made by the second audit pass, 2026-07-28. Listed so a reader who works from an
older copy can tell what moved.

- **F3's verdict was wrong** and is rewritten. "Spread the source column's
  attributes" would duplicate a frame `zone`, duplicate TEI identity, and fail an
  existing committed assertion. The zone question is an open product decision,
  not a bug with a known fix.
- **F5's reachability explanation was wrong** and is rewritten. Neither split
  builder duplicates a `lineId`; duplicates come from F1 reinserting sibling
  lines. F5 is therefore downstream of F1, not a prerequisite.
- **Q4's positive claim was too broad** and is rewritten. "Structure and text are
  otherwise sound" was true of a TEI→TEI round trip and false of the editor,
  which is the case that matters.
- **F4 had no definition** despite a live `DEFECT F4` spec tag. Now defined.
- **The finding count was wrong**: the header claimed 34 findings over 33
  sections. Now 46 over 46.
