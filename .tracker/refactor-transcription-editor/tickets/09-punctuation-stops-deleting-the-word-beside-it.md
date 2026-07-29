# Ticket 09: Punctuation stops deleting the word beside it

## Parent

`../SPEC.md` § D5 and § B2; `../INVENTORY.md` F35.

## What to build

Typing a full stop after a word makes TEI export delete that word. This is the most damaging defect in the inventory: it needs no unusual action, it is invisible in the editor, and the loss only appears at export.

Fix it in **both** places it lives — the serializer that drops the word, and the plugin that produces the shape the serializer chokes on. One without the other is not a fix.

## Where to start

**Half one — the serializer drops unmarked nodes.** `packages/tei-transcription/src/tei-serializer.ts:354` `exportWord`:

```js
const hasPunctuation = nodes.some(node => node.marks?.some(m => m.type === 'punctuation'));
if (hasPunctuation) {
    for (const node of nodes) {
        const punctuationMark = node.marks?.find(m => m.type === 'punctuation');
        if (punctuationMark) { context.xml.push(`<pc…>${escapeXml(node.text || '')}</pc>`); }
    }
    return;                       // every unmarked node in the group is discarded
}
```

Executed input and output:

```json
[ { "type": "text", "text": "alpha" },
  { "type": "text", "text": ".", "marks": [{ "type": "punctuation", "attrs": { "teiAttrs": {} } }] } ]
```

```xml
<ab><pc>.</pc></ab>
```

The `<w>alpha</w>` is gone.

**Half two — the plugin produces the shape.** `app/src/lib/client/transcriptionEditorSchema.ts:776` `PunctuationHighlighter` marks the punctuation character in place, leaving an unmarked text node immediately followed by a marked one with no whitespace between. `groupIntoWords` (`tei-serializer.ts:283`) splits only on `' '`, so both land in one word group.

Its de-duplication test is also wrong in kind and is why the plugin re-marks endlessly:

```js
if (!node.marks.some(m => m.type.name === 'punctuation'))   // asks about the whole text node
```

That asks whether the *text node* carries the mark, not whether the character at `match.index` does.

**Why no existing test caught this:** the parser appends a boundary after the preceding `<w>` (`tei-parser.ts:163`) and `pm-adapter.ts:94` turns that boundary into a space, so an *imported* standalone `<pc>` sits in its own word group. Only punctuation typed in the editor reaches the broken shape. A round-trip suite that starts from TEI is structurally blind to it — the new tests must start from **editor state**, not from TEI.

## Contract

- `exportWord` emits every node in a word group. Punctuation-marked nodes are wrapped in `<pc>`; unmarked ones continue through the normal word path. No node is silently dropped, ever — the early `return` goes.
- `<w>alpha</w><pc>.</pc>` and the imported-TEI equivalent produce the same XML. A word with punctuation typed in the editor and the same word imported from TEI must export identically.
- The de-duplication test asks whether the *character range* being marked already carries the mark, not whether the containing text node does.
- Punctuation highlighting remains idempotent: re-running it over an already-marked document produces no transaction.
- Existing punctuation round-trip tests keep passing unchanged. If one has to change, that is a signal the fix is wrong — check before changing it.

## Out of scope

- Restricting the plugin's scan to changed ranges. That is ticket 04's performance work and this ticket must not pre-empt it — keep the full scan here, just make it correct.
- Moving punctuation highlighting to a decoration plugin. Named as a possibility in ticket 04; not this ticket.
- The `selectionUpdate` behaviour of any other plugin.

## Acceptance criteria

- [ ] A ProseMirror document containing an unmarked `alpha` followed by a punctuation-marked `.` exports as `<w>alpha</w><pc>.</pc>` (exact XML asserted).
- [ ] Typing `alpha.` into a **mounted** editor and exporting through the app's real path yields the word and the punctuation.
- [ ] The same text imported from TEI and re-exported yields byte-identical XML to the typed case.
- [ ] Punctuation in the middle of a word, and two punctuation marks in a row, both export without loss.
- [ ] Running the highlighter twice over the same document produces no second transaction.
- [ ] The existing punctuation round-trip tests pass unchanged.
- [ ] Both baselines pass.

```bash
cd packages/tei-transcription && pnpm test
cd ../../app
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: new assertions cover the typed-punctuation path from mounted editor to XML; the TEI package suite and the app baseline are green.

## Blocked by

None - can start immediately.
