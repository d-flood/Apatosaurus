# Ticket 28: Line and column numbers become presentation

## Parent

`../SPEC.md` § C and § "Provisional Work Breakdown"; `../INVENTORY.md` Q1.

## What to build

`lineNumber` and `columnNumber` are pure functions of a node's index in its parent, but they are persisted as node attributes and reconciled by transaction. Remove them.

This is the single largest performance item in the epic after repair leaves the keystroke path. An attribute change fails `Node.sameMarkup()`, so ProseMirror destroys and rebuilds the node's DOM subtree — and splitting a line renumbers every line below it:

| Column size | Elements created | Elements destroyed |
| --- | --- | --- |
| 50 lines | 99 | 49 |
| 150 lines | 299 | 149 |
| 300 lines | 599 | 299 |

A plain typed character produces **zero** DOM element churn. Renumbering is the entire difference.

## Where to start

Ticket 01 already answered the question that blocked this, by execution (`../INVENTORY.md` Q1) — **neither attribute is load-bearing for TEI**:

- `lineNumber` is never written to TEI. `tei-serializer.ts:140` emits `<lb>` with `break` and `rend` only; `tei-parser.ts:437` recomputes the number positionally on import, ignoring any `@n`.
- `columnNumber` **is** written (`tei-serializer.ts:131`), but the parser only trusts `@n` matching `/C(\d+)/` (`tei-parser.ts:396`). A plain `"2"` — exactly what the serializer writes — is discarded and the column renumbered by position. Set `columnNumber: 40`, export, re-import: it comes back as `1`.
- The status bar already derives the line number positionally: `TranscriptionEditor.svelte:934` uses `resolvedFrom.index(lineDepth - 1) + 1`.

Sites: `transcriptionEditorSchema.ts` (`Line` and `Column` attributes, `LineNumberNormalizer` at `:1394`), `transcriptionEditorStructure.ts` (the split builders and `repairManuscriptStructureJson`), `tei-serializer.ts:131`.

## Contract

- Both attributes are removed from the schema.
- Numbers are rendered by **CSS counters** — `counter-reset` on the column, `counter-increment` on the line, `content: counter(…)` on a pseudo-element. Not a decoration plugin: counters need no plugin state, no transactions and no mapping, and this ticket exists to remove document mutation, not relocate it.
- `LineNumberNormalizer`'s renumbering pass is deleted. Its `lineId`/`columnId` assignment moves to the document-entry boundary ticket 04 establishes.
- **`lineId` and `columnId` stay.** They are identity, not derived. `LINE_SPLIT_TARGET_LINE_ID_META` and `findLineStartPositionById` depend on them.
- Splitting a line produces **zero** DOM element churn beyond the split line itself.
- `tei-serializer.ts:131` stops emitting a `columnNumber`-derived `@n`. It continues to emit `teiAttrs.n` when the source carried one.
- A scribe's own non-sequential line number continues to survive as `teiAttrs.n`, untouched.

## Out of scope

- Exposing a UI for a scribe's non-sequential line numbering. `../INVENTORY.md` § "Removal discipline" records this as a **pre-existing gap, not a consequence of this change**: the TEI layer carries it, nothing in the UI exposes it. It deserves its own ticket outside this epic — do not solve it here, and do not let its absence block this.
- The line-number gutter's DOM position — ticket 29 moves the chrome out of `renderHTML`. This ticket makes the number a counter; that one makes the gutter a pseudo-element. They are adjacent and 29 depends on this.
- `repairManuscriptStructureJson`'s other duties.

## Acceptance criteria

- [ ] `grep -rn "lineNumber\|columnNumber" app/src packages/*/src` returns nothing outside migration code and comments.
- [ ] Line and column numbers still display correctly, in plain pages and framed pages, asserted in a mounted editor with real CSS.
- [ ] Splitting the middle line of a 300-line column creates and destroys no more than a small constant number of DOM elements — assert a bound, and record the measured figure in `TRACKER.md` beside the table above.
- [ ] `lineId` and `columnId` survive on every node after a load and after an edit.
- [ ] Enter still places the caret correctly, via `LINE_SPLIT_TARGET_LINE_ID_META`.
- [ ] TEI export is byte-identical for a document whose columns carry no `teiAttrs.n`.
- [ ] A document carrying `teiAttrs.n` still exports it.
- [ ] Both baselines pass.

```bash
cd app
pnpm vitest run --project client src/lib/client
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
cd ../packages/tei-transcription && pnpm test
```

Layout assertions need `app.css?inline` injected in `beforeAll`; see `transcriptionEditorLayout.svelte.spec.ts`.

Success: both attributes gone, numbers still correct on screen, DOM churn bounded, TEI unchanged.

## Blocked by

- Ticket 04 (`04-structure-repair-leaves-the-keystroke-path.md`) — the id assignment moves to the document-entry boundary it establishes.
- Ticket 12 (`12-column-split-preserves-attributes-and-caret.md`) — `../INVENTORY.md` Q1 records that removing `columnNumber` must be sequenced after F2.
