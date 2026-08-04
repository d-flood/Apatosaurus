# 02 — Group several identifiers into one segment

## What to build

Let the scholar put more than one verse identifier into the segment slice 01 introduced, and gather witnesses across all of them.

This is the slice that solves the actual problem. A project holding IGNTP transcriptions (indexed as `Rom 1:1`) and a transcription seeded from Robinson-Pierpont (indexed as `B06 B06K1:B06K1V1`) currently presents two disjoint verse lists for one passage; picking either silently collates a subset of the witnesses and produces a well-formed, wrong apparatus. After this slice the scholar selects both identifiers, declares them one passage, names it, and every witness is gathered into a single collation.

The scholar asserts the equivalence. The app never infers, suggests, or verifies it.

Demo: with two transcriptions using different reference conventions in one project, build a segment with both identifiers, run it, and see witnesses from both in one apparatus under one name.

## Where to start

- The segment type, stored shape, and name field that slice 01 delivered. Members is already a list; this slice fills it with more than one entry.
- `app/src/lib/client/collation/collation-runner.ts` — `gatherWitnessesForVerse` (line ~700) resolves one identifier to prepared witnesses, deduping by transcription and handling sigla and corrector hands. Read it fully. The new segment-aware entry point composes over it; it is not modified.
- `app/src/lib/client/collation/collation-runner-gather.spec.ts` — the mocking pattern to extend (`getVerseIndexRowsForVerse` and `getTranscriptionsByIds` via `vi.hoisted`). This is the primary test seam for the whole epic.
- `app/src/lib/components/collation/SetupPhase.svelte` — the verse list and filter (lines ~73-110) become multi-select. The list of identifiers and which transcriptions contribute to each is already computed by `gatherVerses`.
- `app/src/lib/client/collation/gather-verses.ts` — `AggregatedVerse` already carries a `count` of contributing transcriptions, which is what the scholar needs to judge a member before adding it.

## Contract

**Members stay opaque.** Equality is still the only operation performed on a member string. No parsing, no normalization, no similarity comparison, no case-insensitive matching. A scholar who wants `Rom 1:1` and `rom 1:1` treated as one says so by adding both.

**One witness contributes at most one member.** If a transcription resolves under two member identifiers of the same segment, that is an error attributable to the segment: it is surfaced to the scholar and **the segment does not run**. Token streams are never concatenated and there is no first-match-wins rule.

This is the rule most likely to be implemented as a convenience. It must not be. A transcription matching two members nearly always means the scholar asserted an equivalence that is wrong for that document, and producing a witness anyway fabricates a reading out of two different passages — a defect that is invisible in the output and indistinguishable from a genuine variant.

**A witness appears exactly once** regardless of which member matched it, and carries its own siglum. Corrector hands, regularization, normalization, and witness treatment are unaffected by membership.

**Members persist verbatim and in the order the scholar added them.** Exact duplicates collapse; nothing else does.

**The app never suggests an equivalence.** Do not add "identifiers that look similar", "other witnesses may use", or any ranking, highlighting, or ordering of the candidate list by resemblance to an existing member. Having built member-picking, this looks like an obvious refinement. It is the specific thing this epic exists to prevent: it reintroduces uninspectable domain knowledge at the one point where a wrong guess yields a plausible, silently incorrect collation. The candidate list is ordered as it is today.

## Out of scope

- Orphaned-member reporting — slice 03. In this slice a member that resolves to nothing simply contributes no witnesses; do not build reporting for it, and do not make it an error.
- Book- or chapter-level members, and any new verse index rows for them.
- More than one segment per collation.
- Any suggestion, inference, or validation of whether two identifiers *ought* to be equivalent.
- Renaming `gatherWitnessesForVerse` or any other `Verse`-named symbol.
- Improving how member identifiers are displayed. `B06 B06K1:B06K1V1` is accepted as-is; the spec fences this explicitly.

## Acceptance criteria

- [ ] Unit spec: members using different reference conventions resolve into one witness list containing every witness from both.
- [ ] Unit spec: a witness appears exactly once regardless of which member matched it.
- [ ] Unit spec: a one-member segment still returns exactly what the per-identifier path returns — slice 01's behavior is unchanged.
- [ ] Unit spec: a transcription matching two members of one segment produces a surfaced error and **no** witnesses for that segment. Assert on the reported outcome, not merely that something threw.
- [ ] Unit spec: corrector hands and sigla are identical whether a witness was gathered under a one-member or a multi-member segment.
- [ ] Unit spec: exact-duplicate members collapse; members differing by case, spacing, or punctuation do not.
- [ ] The setup screen allows adding and removing members, and shows how many transcriptions contribute to each candidate identifier.
- [ ] No test asserts how many times the per-identifier function was called, or in what order members were resolved.
- [ ] `gatherWitnessesForVerse` is unchanged.

Commands:

```sh
cd app && pnpm run check && pnpm run test:unit -- --run
```

Success = both exit 0.

## Blocked by

- 01 — the segment type, its stored shape, and the name field.
