# 02 — Paste creates unconfirmed text

## What to build

The first complete path for **unconfirmed text**: a scholar pastes text into the transcription editor, it arrives visibly flagged as not yet checked against the manuscript, editing a word clears the flag from that word, and the flag survives a TEI export/import round trip.

This slice introduces the `unconfirmed` mark and everything needed to create, clear, render, serialize, and re-parse it. Later slices reuse it; **nothing else in this epic can start without it.**

Demo: paste a line of Greek into a transcription. It renders highlighted. Type over one word — that word's highlight clears, the rest stays. Export TEI: the still-unconfirmed text is wrapped in `<seg type="unconfirmed">`. Re-import that TEI: the highlighting comes back.

## Where to start

Read these before writing anything:

- `packages/tei-transcription/src/types.ts` — the `TextMark` union (around line 246). The new mark joins it.
- `packages/tei-transcription/src/pm-adapter.ts` — mark mapping runs in **both** directions; the AST→PM side is around lines 602-637. Both must handle the new mark.
- `app/src/lib/client/transcriptionEditorSchema.ts` — where marks are registered for the editor. `transformPastedText: text => text` at ~line 2572 is the current identity paste handling, inside the main-manuscript profile block.
- `packages/tei-transcription/src/tei-serializer.ts` — the mark switch at ~lines 805-866. **It has no default case**: an unrecognized mark is silently dropped. That is why serialization is in this ticket rather than a later one.
- `packages/tei-transcription/src/tei-parser.ts` — where `<seg>` is currently handled. Note that generic wrappers become the `teiSpan` mark; see the Contract for why that matters.
- `packages/tei-transcription/src/normalize.ts` — `sameMarks` at line 14 decides whether adjacent text runs merge.
- Test prior art: `app/src/lib/components/transcriptionEditor/toolbar-insertions.svelte.spec.ts` and its `ToolbarInsertionHarness.svelte`. This is the pattern to copy — render a harness, drive real affordances, assert on exported XML from a `data-testid`.

## Contract

**The mark.**

```ts
| { type: 'unconfirmed'; attrs?: Record<string, string> }
```

Its meaning is **"not yet confirmed against the manuscript"** — a statement about human attention, not about where the text came from. Do not name it `seeded`, `pasted`, or `provenance`.

**Clearing semantics.** Both are contracts and both need tests, not comments:

1. **The mark is non-inclusive.** ProseMirror marks are inclusive by default, meaning typing inside or at the edge of a marked range *extends* the mark. That is the exact opposite of what is required here, and the naive implementation gets it wrong while looking fine in a smoke test. Text the scholar types must never inherit the mark.
2. **Editing clears only the touched text run.** Fixing one word in a verse does not clear the rest of the verse. Do not widen clearing to the line, the verse, or the paragraph.

**Paste.** Pasted plain text becomes text with word separation, matching what typed text produces, and carries the mark. The invariant this slice establishes, stated without exception:

> Text that entered the document from outside is unconfirmed until a human confirms it, regardless of how it got in.

**TEI serialization.** The mark serializes as `<seg type="unconfirmed">`. This is valid under the manuscripts schema (`seg` carries `att.typed`).

**TEI parsing — the trap.** The importer must parse `<seg type="unconfirmed">` back into the `unconfirmed` mark, **not** into the generic `teiSpan` mark. `teiSpan` is the catch-all for arbitrary wrappers and is the path of least resistance; taking it produces a round trip whose XML compares equal while the semantic flag is gone and the editor shows nothing. The round-trip test must assert **the mark type**, not XML equality.

**Normalization.** Adding a mark member will stop `sameMarks` merging adjacent unconfirmed and confirmed text runs. That is correct. Existing normalization expectations may move; update them rather than special-casing the new mark out of `sameMarks`.

## Out of scope

- The explicit per-verse review action, the layers toggle entry, the unconfirmed count, and the export warning. All ticket 03.
- Reference editions, seeding, catalogs, pickers. Tickets 04 onward.
- Rich paste (HTML, TEI-on-the-clipboard). Plain text only.
- Any change to the collation `isBaseText` flag or the collation document format.
- Rewriting `transformPastedText`'s surrounding editor profile configuration beyond what paste handling needs.

## Acceptance criteria

- [ ] Browser spec, via a harness following the `ToolbarInsertionHarness` pattern: pasting text produces content that exports wrapped in `<seg type="unconfirmed">`.
- [ ] Browser spec: typing over one word inside a pasted run clears the mark from that word only — the exported XML shows the edited word outside `<seg type="unconfirmed">` and its neighbours still inside.
- [ ] Browser spec: text typed immediately adjacent to an unconfirmed run is **not** wrapped in `<seg type="unconfirmed">` on export (non-inclusive).
- [ ] Package round-trip spec: serialize a document containing the mark, re-parse it, and assert the resulting mark's `type` is `unconfirmed` and not `teiSpan`.
- [ ] The XSD suite still passes with a document containing `<seg type="unconfirmed">`.
- [ ] Any new phosphor icon is added to `optimizeDeps.include` in `app/vite.config.ts`.

Commands:

```sh
cd packages/tei-transcription && pnpm run test
cd app && pnpm run check && pnpm run test:unit -- --run && pnpm run test:e2e
```

Success = all exit 0.

## Blocked by

None - can start immediately.
