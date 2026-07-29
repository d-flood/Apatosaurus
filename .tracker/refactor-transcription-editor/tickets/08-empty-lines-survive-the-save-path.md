# Ticket 08: Empty lines survive the save path

## Parent

`../SPEC.md` § D6; `../INVENTORY.md` F36.

## What to build

A blank line typed in the editor disappears on reload. `normalizeColumn` filters out every line with no items, `fromProseMirror` calls it, and autosave persists that result as the canonical document. The editor's own Enter-on-a-blank-line command is therefore undone by the next save.

Make an intentional empty line survive a save-and-reload cycle.

## Where to start

`packages/tei-transcription/src/normalize.ts:145`:

```js
const normalizedLines = column.lines.map(normalizeLine).filter(line => line.items.length > 0);
```

Executed today:

```text
ProseMirror lines before save:  ["alpha", "", "beta", ""]
fromProseMirror result:         ["alpha", "beta"]
persisted reload:               ["alpha", "beta"]
remaining stored line numbers:  [1, 3]
```

An all-empty column collapses to a single empty line.

Call chain: `pm-adapter.ts:464` `fromProseMirror` → `normalizeDocument`; `TranscriptionEditor.svelte:1064` autosave → `coerceEditorJsonToDocument` → `fromProseMirror`. `normalizeDocument` is also called from `tei-parser.ts:102` (import) and `app/src/lib/client/transcription/content.ts:24` — **check all four call sites**, because relaxing the filter changes what each of them produces.

The only caller of `createEmptyLineInsertTransaction` is the Enter keybinding at `transcriptionEditorSchema.ts:1525`. That is the command whose output is being discarded, and it is the behaviour to protect.

**Read `packages/tei-transcription/tests/normalize.spec.ts:6` first.** Its "keeps at least one line in every column after empty lines are filtered" test locks the current behaviour in. This ticket flips it. Before you do, satisfy yourself that the filter was not load-bearing for something undocumented — parser output with trailing structural blanks is the likely original motivation, and if so the fix belongs at the parser, not in the shared normalizer.

## Contract

- A line the user created is preserved through `fromProseMirror` → store → reload, wherever it sits in the column, including at the end.
- Line numbering after a round trip is contiguous and matches what the editor shows.
- The existing structural guarantees stay: every column has at least one line, every page at least one column. Those guards are why `normalizeColumn` exists and they are not the defect.
- Importing TEI does not gain spurious blank lines. If the parser emits structurally empty lines that were never a scribe's blank line, they are filtered **at the parser**, and a test says so.
- `normalizeDocument` remains idempotent.

## Out of scope

- `normalizeLineItems` and the boundary-trimming logic above it.
- The autosave debounce and its conversion cost — tickets 04 and 20.
- Any change to how the editor *renders* an empty line.

## Acceptance criteria

- [ ] A document with lines `["alpha", "", "beta", ""]` survives `fromProseMirror` with all four lines and contiguous numbering.
- [ ] An all-empty column keeps every one of its lines rather than collapsing to one.
- [ ] A column with no lines at all still gets exactly one, and a page with no columns still gets one.
- [ ] `normalizeDocument(normalizeDocument(d))` deep-equals `normalizeDocument(d)` for a fixture containing blank lines.
- [ ] A TEI import produces no blank line that was not in the source.
- [ ] Pressing Enter on a blank line in a mounted editor, then running the real autosave conversion, yields a document containing both lines.
- [ ] `normalize.spec.ts:6` is updated in place with a comment naming this ticket.
- [ ] Both baselines pass.

```bash
cd packages/tei-transcription && pnpm test
cd ../../app
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: the TEI package suite is green with the rewritten normalize test; the round-trip spec is unchanged and still passes; `check` and the app unit suite are green.

## Blocked by

None - can start immediately.
