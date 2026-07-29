# Ticket 24: Corrections on partial and multi-word selections export correctly

## Parent

`../INVENTORY.md` R1.

## What to build

**Reproduce this first. It may be a one-keystroke data loss, in which case it stops being a Wave G ticket and gets done immediately.**

`exportWord` detects a correction mark on *any* node in a whitespace-delimited word group, then `exportCorrection` reads the mark from `nodes[0]` only:

```js
function exportCorrection(nodes, context) {
    const correctionMark = nodes[0]?.marks?.find(mark => mark.type === 'correction');
    if (!correctionMark) return;        // whole word vanishes
    …
}
```

Marking a suffix or a middle span leaves the first fragment unmarked, so this returns without emitting either the original or the corrected word — and `exportWord` has already committed to the correction branch, so nothing else emits it either. The entire word disappears from the TEI.

A correction spanning multiple words has the mirrored error: the same apparatus is emitted independently for every word group, so one correction becomes several.

The selection UI permits both partial-word and multi-word ranges. Existing correction fixtures cover only whole single words, which is why neither has been seen.

## Where to start

`packages/tei-transcription/src/tei-serializer.ts:354` (`exportWord`'s correction branch) and `:424` (`exportCorrection`).

Note the structural similarity to F35 / ticket 09: a `some()` guard that commits to a branch, followed by an emit that handles a narrower case than the guard admitted. **Read ticket 09's resolution before starting** — if it has landed, the same shape of fix probably applies, and the two should end up consistent.

Step one is a spec that builds the three shapes directly as ProseMirror JSON — suffix-marked word, middle-marked word, mark spanning two words — and exports each.

## Contract

- A correction mark covering any part of a word exports that word exactly once, with its apparatus. No node is dropped.
- A correction spanning several words produces **one** apparatus covering the span, not one per word.
- Whole-word corrections — the case that works today — export byte-identically to their current output. Assert this before changing anything.
- `exportCorrection` reads the mark from wherever it is, not from `nodes[0]`.
- **Decide what a partial-word correction means in TEI and write it down.** `<app>` around the whole word with the reading showing the corrected form is the likely answer, but it is a scholarly question about what the apparatus claims, not a mechanical one. Record it in `TRACKER.md`.

## Out of scope

- The selection UI. Restricting corrections to whole words would be an alternative fix, and it is the wrong one — a scribe correcting a single letter is ordinary, and the model should record it.
- Correction *content* storage — ticket 22.
- The correction workspace's metadata handling — ticket 21.

## Resolution

The human-confirmed comparison unit is one or more complete words. A scholar may
select a single letter, but applying or removing a correction expands the range
to the containing word boundaries. Every correction reading therefore contains
the complete corrected word sequence. `<app>` records the word-level comparison
locus; it does not claim that every character in the word changed.

The IGNTP XSD permits nested sub-word `<app>`, but the application deliberately
uses the whole-word form because collation and corrector extraction consume word
tokens. The correction workspace now states the complete-reading requirement,
and consecutive words carrying the same correction emit that reading once during
corrector extraction.

## Acceptance criteria

- [ ] A correction mark on the suffix of a word exports the word with its apparatus.
- [ ] The same for a mark on a middle span.
- [ ] A correction spanning two words produces exactly one `<app>`.
- [ ] Whole-word correction output is byte-identical to before the change, asserted against captured current output.
- [ ] Each of the three cases round-trips: export, re-import, re-export, byte-identical.
- [ ] `TRACKER.md` records the partial-word semantics decision.
- [ ] If the defect reproduces as described, it is noted in `TRACKER.md` that it was severity-misclassified as Wave G.
- [ ] Both baselines pass.

```bash
cd packages/tei-transcription && pnpm test
cd ../../app
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: three new export cases pass, whole-word output is unchanged, both suites green.

## Blocked by

None - can start immediately. Best done after ticket 09, which fixes the same shape of bug in the neighbouring branch of the same function.
