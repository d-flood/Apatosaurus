# Ticket 12: Column split preserves attributes, numbers per page, and keeps the caret

## Parent

`../SPEC.md` § D4 (the narrowing paragraph); `../INVENTORY.md` F2, F3, F4, F37.

## What to build

`createColumnSplitTransaction` gets its line handling right and everything else wrong. Four defects in one 40-line function, fixed in one pass:

- **F2** the new column is numbered from the **document-wide** maximum, so splitting page 1's column in a document whose page 2 has columns 1 and 2 produces `[1, 3]`.
- **F4** because repair renumbers positionally, that wrong number means every split fails repair, which answers with a whole-document `replaceWith(0, doc.content.size, …)`. The settled document is correct, so the cost is invisible.
- **F3** the new column is created without spreading the source column's attributes, so it loses `teiAttrs` and drops out of the frame layout.
- **F37** no target selection is set, so the caret maps to the replacement boundary and lands in the *following* column — and then the repair replace maps it again, to a different page.

## Where to start

`app/src/lib/client/transcriptionEditorStructure.ts:550`.

```js
const nextColumnNumber = Math.max(0, ...state.doc.content.content.flatMap(pageNode => …)) + 1;

const newFirstColumn  = state.schema.nodes.column.create({ ...columnNode.attrs }, firstColumnLines);
const newSecondColumn = state.schema.nodes.column.create({ columnNumber: nextColumnNumber, columnId: null }, secondColumnLines);

return state.tr.replaceWith(columnPos, columnPos + columnNode.nodeSize, [newFirstColumn, newSecondColumn]);
```

Observed caret behaviour on the multi-page fixture: a caret in page 2 column `b` line `b3` came out in page 2 column `c` line `c1` in the raw transaction, then in page 3 line `d4` after the appended repair.

Tagged assertions to flip: `DEFECT F2`, `DEFECT F3` and `DEFECT F4` in `app/src/lib/client/transcriptionEditorStructuralCommands.svelte.spec.ts:184`, `:214`, `:234`.

## Contract

**Numbering.** The new column is numbered from its index within **its own page**, not from a document-wide scan. Splitting the only column of a page yields `[1, 2]` regardless of what any other page contains.

**Attributes.** Carry the source column's `teiAttrs` **minus identity keys** onto the new column. `columnId` continues to be cleared. If `teiAttrs` carries `xml:id`, that is TEI identity and must be cleared too — duplicating an `xml:id` across two columns is its own defect.

**Zone — do not copy it.** This is the constraint most likely to be got wrong. `../INVENTORY.md` F3's original verdict said "spread the source column's attributes", and that was corrected: a framed page has five named zones and `.frame-grid` positions children by `data-zone`, so two columns both claiming `center` is not a repaired document. `transcriptionEditorStructure.svelte.spec.ts:160` asserts the new column is unzoned and **must keep passing**.

What splitting a zoned column *should* mean is an open product decision — refuse the split, let a zone hold several columns, or prompt for the new zone. Ticket 05 owns the frame layout and will decide. Until then, unzoned is the least-wrong behaviour. Do not decide it here.

**Caret.** The transaction sets its own selection. The caret lands at the start of the content that moved into the second column — i.e. where the user's text now is, not where the boundary fell. It never lands in a different page.

**Repair.** With numbering fixed, `repairManuscriptStructureJson(tr.doc).repaired` is `false` for a split. The whole-document replace stops happening as a consequence, not by touching the normalizer.

## Out of scope

- Removing `columnNumber` entirely. That is ticket 28, and it is sequenced *after* this one — `../INVENTORY.md` Q1 says the removal has to follow F2.
- Changing `LineNumberNormalizer` or the repair function itself — ticket 04.
- `createLineSplitTransaction` — ticket 02.
- Deciding the frame-zone semantics — ticket 05.

## Acceptance criteria

- [ ] Splitting page 1's only column, in a document where page 2 has columns 1 and 2, produces `[1, 2]` on page 1 and leaves page 2 untouched.
- [ ] `repairManuscriptStructureJson(tr.doc).repaired === false` for that split transaction — the `DEFECT F4` assertion inverted.
- [ ] Splitting a column with `teiAttrs: { rend: 'center' }` gives the new column those attributes.
- [ ] An `xml:id` on the source column does not appear on the new column.
- [ ] Splitting the `center` zone column still leaves the new column unzoned, and `transcriptionEditorStructure.svelte.spec.ts:160` passes unmodified.
- [ ] After a split with the caret mid-line in `b3` of a multi-page fixture, the caret is in the new column on the same page, at the start of the moved text.
- [ ] Sibling pages are byte-identical before and after a split.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/client/transcriptionEditorStructuralCommands.svelte.spec.ts
pnpm vitest run --project client src/lib/client/transcriptionEditorStructure.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: three tagged assertions inverted and passing, the unzoned assertion untouched and passing, baseline green.

## Blocked by

None - can start immediately.
