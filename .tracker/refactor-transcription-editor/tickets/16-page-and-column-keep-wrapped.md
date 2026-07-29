# Ticket 16: Page and column keep `wrapped`

## Parent

`../INVENTORY.md` F13.

## What to build

A word continuing across a page or column boundary is `break="no"` in TEI. Four layers know about it and one does not, and the one that does not is the one every document passes through.

The parser records it (`TranscriptionPage.wrapped`, `TranscriptionColumn.wrapped`), `toProseMirror` emits it as an attribute, `fromProseMirror` reads it back, and the serializer writes it. Neither `Page` nor `Column` declares a `wrapped` attribute in the editor schema, so ProseMirror discards it on load. `Line` does declare it, so the line-level flag survives.

**Any document that passes through the editor loses page- and column-level word continuation.**

## Where to start

`app/src/lib/client/transcriptionEditorSchema.ts:1058` (`Page.addAttributes`) and `:1167` (`Column.addAttributes`). Compare against `Line`'s declaration, which is the working example.

Tagged assertion: `DEFECT F13` in `app/src/lib/tei/teiRoundTrip.svelte.spec.ts:131`.

## Contract

This ticket carries an explicit either/or, and **the point is that the choice gets made deliberately** rather than defaulting to whichever is cheaper:

**Option A — restore it.** Declare `wrapped` on `Page` and `Column`, with the same `parseHTML`/`renderHTML` treatment `Line` uses. Real document data about word continuation across a physical boundary; four layers already carry it.

**Option B — remove it everywhere else.** If the line-level flag genuinely suffices to reconstruct page- and column-level continuation — a word wrapping across a page boundary is also wrapping across the last line of that page — then stop parsing and serializing it at the other three layers, and delete the fields.

**Do not leave the current state**, where three layers carry a value the fourth throws away.

The test for choosing: *can a scholar record something under one option that they cannot under the other?* If the line-level flag is genuinely equivalent, B is the removal this epic's bias prefers. If there is any manuscript shape where page-level `wrapped` says something line-level `wrapped` cannot, A is required. Work that out against a real example before writing code, and record the reasoning in `TRACKER.md`.

Whichever is chosen:

- A TEI document with `break="no"` on `<pb>` and `<cb>` round-trips through the editor without loss of meaning.
- The `DEFECT F13` assertion is inverted or replaced with one asserting the chosen semantics.
- `Line`'s existing `wrapped` behaviour is unchanged.

## Out of scope

- The `wrapped` UI (the word-wrap toggle in `EditorToolbar.svelte`), unless option B removes something it depends on.
- The wrapped-arrow chrome in `Line.renderHTML` — ticket 29.
- Any other undeclared attribute. If you find one while here, record it in `../INVENTORY.md` rather than fixing it.

## Acceptance criteria

- [ ] `TRACKER.md` records which option was chosen and the manuscript-level reasoning, in two or three sentences.
- [ ] A TEI fixture with `break="no"` on both `<pb>` and `<cb>` survives import → editor → export with its meaning intact.
- [ ] The `DEFECT F13` assertion is inverted or replaced, not deleted.
- [ ] Under option B, `grep -rn "wrapped" packages/tei-transcription/src` shows no page- or column-level occurrence.
- [ ] Line-level `wrapped` behaviour is unchanged, asserted by an existing test still passing.
- [ ] Both baselines pass.

```bash
cd app
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
cd ../packages/tei-transcription && pnpm test
```

Success: the round-trip spec asserts the chosen semantics and passes; both suites green; the decision is written down.

## Blocked by

None - can start immediately.
