# Collation Segments

## Problem Statement

A scholar's project can contain transcriptions that name the same verse differently, and the app has no way to know they mean the same thing.

The two sources that ship with Apatosaurus already disagree. The bundled IGNTP corpus encodes references as `<div type="book" n="Rom">`, `<div type="chapter" n="Rom.1">`, `<ab n="Rom.1.1">`, which the importer decomposes and the verse index stores as the identifier `Rom 1:1`. The bundled Robinson-Pierpont edition encodes the same verse as `B06`, `B06K1`, `B06K1V1`; a transcription seeded from it indexes under a wholly different identifier. Neither encoding is wrong, and neither is going away — INTF and IGNTP both have decades of material in their own conventions, and scholars import from both.

The collation setup screen lists verses by identifier and gathers witnesses by exact identifier match. So a project holding transcriptions from both worlds presents the scholar with two disjoint verse lists for the same text. Choosing one silently collates a subset of the available witnesses. There is no error, no warning, and no visible symptom: the collation runs, produces a well-formed apparatus, and simply omits every witness that named the verse the other way. In a discipline whose entire output is claims about which witnesses attest which readings, silently dropping witnesses is the most damaging failure the app can have — worse than crashing, because the result looks usable.

The problem is not limited to two systems. Apatosaurus is not a New Testament tool that happens to be general; it is a transcription and collation tool whose first corpus is the New Testament. Scholars work on lectionaries, on non-biblical manuscripts, and on texts with reference schemes that match no published system at all. The shipped IGNTP Romans corpus already contains `Rom.inscriptio` and `Rom.subscriptio`, which belong to no versification scheme. Any solution that works by understanding biblical versification would fail these cases at exactly the moment the app moved beyond its first use case.

Several approaches were considered and rejected before this one. Converting every transcription to a canonical internal versification at import rewrites the scholar's data on the way in, makes a parser bug permanent, and requires the app to hold a mapping between book numbers and book names that it cannot verify. Parsing several known systems and treating them as equivalent has the same problem in a different place, and still fails arbitrary references. Rewriting the bundled Robinson-Pierpont asset to match IGNTP conventions would require twenty-seven book abbreviations, of which exactly one — `Rom` — can be verified against anything in this repository; a wrong abbreviation would produce precisely the silent mismatch the change was meant to eliminate, baked into a bundled asset.

What all of these have in common is that they put domain knowledge the app cannot verify into code the scholar cannot inspect.

## Solution

Introduce the **collation segment**: a named set of verse identifiers that a collation treats as one unit of text.

A scholar setting up a collation selects the verse they want from the identifiers their witnesses actually use — `Rom 1:1` from the IGNTP transcriptions, `B06 B06K1:B06K1V1` from the Robinson-Pierpont-seeded one — declares that those identifiers denote the same passage, and gives the segment a name. The collation gathers witnesses across every member identifier and runs once. The name the scholar typed is the only reference that appears in the output.

The app never interprets a milestone value. It does not know that `B06` means Romans, that `B06K1V1` and `Rom.1.1` are the same verse, or that either is a verse in any sense beyond being a milestone the document contained. The equivalence is asserted by the scholar, who has the documents in front of them and knows what they hold. This is the only design considered that satisfies the requirement the app must meet at all: arbitrary reference schemes, including ones that match no system and never will, work identically to biblical ones, because a set of identifiers needs no structure to exist.

A scholar who wants a published edition as a collation base text creates a transcription from it — seeding an ordinary transcription from a reference edition, which the app already supports — and collates that. Reference editions themselves remain what they have always been: never a witness, never collated.

Nothing about the verse index, the TEI parser, the TEI serializer, the bundled Robinson-Pierpont asset, or the reference edition picker changes. Robinson-Pierpont identifiers remain ugly; the segment name is what a reader of the apparatus sees, so the ugliness is confined to one picker in one screen.

## User Stories

### Defining a segment

1. As a scholar, I want to select more than one verse identifier and treat them as one passage, so that witnesses using different reference conventions can be collated together.
2. As a scholar, I want to give a segment my own name, so that the apparatus cites the passage the way my edition cites it rather than the way any one witness happens to encode it.
3. As a scholar, I want the name I typed to be the only reference in the collation's output, so that no witness's internal encoding leaks into work I publish.
4. As a scholar collating witnesses that all use one convention, I want a segment with a single member to behave exactly as collation does today, so that the common case gains no ceremony.
5. As a scholar, I want to see which transcriptions contribute to each identifier before I add it, so that I can tell whether I am about to include the witnesses I intended.
6. As a scholar, I want to remove a member from a segment, so that I can correct a mistaken equivalence without rebuilding the whole setup.
7. As a scholar, I want to rename a segment after creating it, so that a naming decision is not locked in by the order I did things.
8. As a scholar, I want to be required to name a segment, so that no collation can be run against a passage nobody has decided how to cite.
9. As a scholar, I want the app never to invent a name for a segment, so that a raw identifier can never reach an apparatus by way of a default.
10. As a scholar working with an arbitrary reference scheme, I want to group identifiers that belong to no versification system, so that non-biblical and irregular material is a first-class case rather than an exception.
11. As a scholar, I want to group identifiers like `Rom.inscriptio` that are not verses at all, so that the parts of a manuscript outside the verse structure can still be collated.

### Running a collation over a segment

12. As a scholar, I want a collation over a segment to gather witnesses from every member identifier, so that my apparatus reflects every witness in my project that attests the passage.
13. As a scholar, I want each witness to appear once regardless of which member identifier it matched, so that a witness is never double-counted because of how it names its verses.
14. As a scholar, I want the witnesses gathered under a segment to carry their own sigla, so that the apparatus identifies witnesses by manuscript, not by which naming convention they used.
15. As a scholar, I want corrector hands to be gathered under a segment exactly as they are today, so that adding a segment does not change how hands are treated.
16. As a scholar, I want regularization, normalization, and witness treatment settings to apply unchanged to a segment, so that my project's collation settings mean the same thing they did before.

### When something is wrong

17. As a scholar whose transcription matches two members of one segment, I want to be told, so that I discover an incorrect equivalence rather than silently collating two different verses as one witness.
18. As a scholar, I want a segment with a double match to refuse to run rather than pick one, so that the app never guesses which of two passages I meant.
19. As a scholar whose member identifier no longer exists — because I re-imported or edited a transcription — I want that surfaced as orphaned, so that a vanished witness is never mistaken for a manuscript that does not attest the passage.
20. As a scholar, I want an orphaned member reported without blocking the rest of the collation, so that one stale identifier does not stop work on the witnesses that are still there.
21. As a scholar, I want the difference between "this witness does not attest" and "this witness was not gathered" to remain visible, so that the distinctions my analysis depends on are never quietly collapsed.
22. As a scholar, I want the app never to suggest that two identifiers are equivalent, so that no equivalence in my collation is one I did not personally assert.

### Persistence

23. As a scholar, I want my segments saved with the collation, so that reopening it later does not mean redefining every equivalence.
24. As a scholar, I want segments scoped to the collation I am building, so that an equivalence I asserted for one piece of work does not silently apply to another.
25. As a scholar, I want a saved collation to reopen citing the same names, so that my apparatus is stable across sessions.
26. As a scholar exporting a collation, I want segment names to appear where verse references appear today, so that exports need no explanation of the app's internal identifiers.

## Implementation Decisions

### The segment

A collation segment is a named set of verse identifiers, owned by the collation document.

```ts
interface CollationSegment {
	id: string;
	name: string; // scholar-supplied; required; never derived
	members: string[]; // verse identifiers exactly as stored in the verse index
}
```

A collation carries exactly one segment — it collates one passage, as the setup screen does today. Multi-segment collations are a separate feature with their own questions (ordering, per-segment witness sets) and are not introduced here; consequently there is no name-uniqueness rule, because there is never a second name to collide with.

`members` holds verse index identifiers verbatim — the strings `normalizeVerseIdentifier` already produces. No parsing, normalization, or transformation is applied to them at any point. A member is an opaque key.

The name is required at creation and has no default. There is no code path anywhere that derives a name from a member identifier. This is deliberate and load-bearing: the guarantee that no internal identifier reaches an apparatus is only as strong as the absence of a fallback that could produce one.

There are no existing collations in the wild, so the collation document's setup shape changes directly. The `selectedVerse` / `selectedBook` / `selectedChapter` / `selectedVerseNum` fields are replaced by the segment; no upgrader is written, and the migrate-on-read registration is updated in place.

### Gathering

The collation runner gains a segment-aware gather entry point. It takes a segment and the selected transcription ids, and returns prepared witnesses.

It resolves each member identifier through the existing per-identifier gather path, which is not modified and keeps its current name — the existing function still does exactly what it is called, and the no-rename decision below applies. The new entry point composes over it; it does not replace it.

Two rules govern the composition:

- **One witness contributes at most one member.** If a transcription resolves under two member identifiers of the same segment, that is an error attributable to the segment, surfaced to the scholar, and the segment does not run. The witness's token streams are never concatenated, and no first-match-wins rule exists. A transcription matching two members almost always means the scholar asserted an equivalence that is wrong for that document, and producing a witness anyway would fabricate a reading from two different passages.
- **A member that resolves to no transcription is orphaned.** It is reported, using the existing `orphaned decision` vocabulary, and the collation proceeds with the members that did resolve. Orphaned members must never reduce the witness list silently, because a witness missing from an apparatus is indistinguishable from a witness that does not attest — the one confusion the project's `non-attestation` / `omission` / `untranscribed witness` distinctions exist to prevent.

Witness identity, sigla, hands, correctors, `sourceVersion`, regularization, normalization, and witness treatment are all unchanged. The runner's witness source remains transcriptions only.

### Output

The segment name replaces the verse identifier everywhere a collation currently displays or exports one. Member identifiers do not appear in the workspace, the apparatus, or any export.

### Unchanged

The following are explicitly not modified, and a change to any of them indicates the work has gone wrong:

- The verse index — schema, extraction, identifiers, and rebuild path.
- The TEI parser and serializer, including `opaqueMilestoneLabels` and `sourceLabel` handling.
- The bundled Robinson-Pierpont asset.
- The reference edition picker and the seeding path.
- The per-identifier witness gather function and everything below it.
- The roughly sixty files carrying `Verse`-based naming. Their names remain accurate: segments are verse-level, and the code that gathers verses still gathers verses. What changed is that *selection* moved from one identifier to a named group, which is new code with a new name, not renamed code.

### Vocabulary

`CONTEXT.md` gains one entry under Collation:

**Collation segment** — a named set of verse identifiers a collation treats as one unit of text, so that witnesses using different reference conventions can be collated together. The scholar asserts the equivalence and supplies the name; the app never infers either. Its name is the only reference that appears in output. _Avoid_: Collation unit (a variation unit is a place within a segment), verse group, alias.

The existing **reference edition** and **base text** entries are unchanged and remain accurate: reference editions are still never witnesses and never collated, and a base text is still a transcription.

## Testing Decisions

A good test here asserts what a scholar would observe — which witnesses came back, what the collation cites, what was reported as wrong — and never how the resolution was performed. Tests that assert call counts against the per-identifier gather function, or the order in which members were resolved, are testing the implementation and will obstruct the refactoring this design leaves open.

Two seams, both extensions of existing ones.

**Seam A — the segment-aware gather entry point in the collation runner.** This is the primary seam and carries most of the coverage. Prior art is `collation-runner-gather.spec.ts`, which drives the existing gather function directly with `getVerseIndexRowsForVerse` and `getTranscriptionsByIds` mocked; the same pattern extends without new infrastructure. Cases:

- Members from different naming conventions resolve into a single witness list.
- A witness appears exactly once regardless of which member matched it.
- A single-member segment returns what the existing per-identifier path returns.
- A transcription matching two members produces a surfaced error and no witnesses for that segment — asserted on the reported outcome, not on an exception type alone.
- A member matching no transcription is reported as orphaned while the remaining members still gather.
- Corrector hands and sigla are unaffected by segment membership.

**Seam B — collation document round-trip.** Prior art is `collation-document.spec.ts`. That a segment's name and members survive save and load, that the name is what the document exposes as the collation's reference, and that name uniqueness within a collation is enforced.

No end-to-end spec is added. There is no collation e2e coverage today, and building the first one here would be the largest cost in the epic while covering the least risky part of it — the risk in this design is in resolution and reporting, both fully observable at Seam A.

The authoring UI in the collation setup phase — selecting members, typing a name — is covered manually unless a component spec in the existing `*.svelte.spec.ts` style proves cheap once the state shape is settled.

## Out of Scope

**Cross-witness suggestion of equivalent identifiers.** The app must never propose that two identifiers denote the same passage, whether by pattern, table, heuristic, or similarity. This is the most likely thing to be built by mistake: once member-picking exists, suggesting `B06K1V1` when the scholar picks `Rom.1.1` looks like an obvious refinement. It is not. It reintroduces uninspectable domain knowledge in the one place where a wrong guess produces a plausible, silently incorrect collation — the exact failure this epic exists to remove.

**Book- and chapter-level segments.** Segments are verse-level. Collating a whole chapter or a whole book is not supported, and no book- or chapter-level rows are added to the verse index.

**Any versification mapping.** No book abbreviation table, no `B01`-to-book-name mapping, no conversion of the bundled Robinson-Pierpont asset, no parser change to decompose compound identifiers, no bulk conversion of a scholar's library between conventions.

**Member identifier legibility.** The verse index is not extended to carry `sourceLabel`, and the setup picker continues to display the identifiers it displays today, including `B06 B06K1:B06K1V1`. If this proves a genuine obstacle it will be addressed by editing the Robinson-Pierpont source, not by adding a display layer.

**Renaming the `Verse`-named modules.** See Implementation Decisions.

**Reference editions as witnesses.** Only transcriptions are collated. A scholar wanting a published edition as a base text creates a transcription from it.

**Reference edition seeding lookup.** Finding a passage in the Robinson-Pierpont picker still requires knowing its `B##` book number. Unchanged, and accepted.

## Further Notes

**A separate, unrelated bug.** `sortVerses` orders by `Number(a.verse) - Number(b.verse)`. The shipped IGNTP Romans corpus contains `Rom.inscriptio` and `Rom.subscriptio`, which produce `NaN` and therefore a comparator returning `NaN` — an unspecified sort order. This is live today, independent of this epic, and should be its own ticket. It is mentioned here because the verses it mishandles are exactly the arbitrary-reference case this design is built to support, and a reader may otherwise assume this epic addressed it.

**Collation size.** `collate` is invoked with no size limit, timeout, or cancellation. Verse-level segments keep the alignment problem the same size it is today, so this epic does not make it worse — but it is why book- and chapter-level segments were dropped rather than deferred, and it should be understood before that decision is revisited.

**Why the equivalence is per collation.** Segments are collation-owned rather than project-owned so that an equivalence asserted for one piece of work cannot silently govern another. A scholar's judgement that two identifiers denote the same passage is made against a specific set of witnesses for a specific purpose; it is not a standing fact about the project. If reuse across collations proves necessary, promoting a collation-owned set to a project-owned one is additive and can be done later; the reverse is not.
