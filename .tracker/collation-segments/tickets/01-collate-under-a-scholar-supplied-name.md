# 01 — Collate a verse under a scholar-supplied name

## What to build

The whole collation-segment path, end to end, with exactly one member.

A scholar sets up a collation, picks a verse the way they do today, **types a name for it**, and runs. The workspace and every export cite the name they typed. The underlying verse identifier — `Rom 1:1`, or `B06 B06K1:B06K1V1` for a Robinson-Pierpont-seeded transcription — never appears anywhere the scholar or a reader of the apparatus can see.

Nothing about which witnesses are gathered changes in this slice. One member behaves exactly as collation behaves now. What changes is that the collation's unit of text is a **collation segment** — a named set of verse identifiers — that happens to have one member, and that the name is scholar-supplied rather than derived from the data.

This is the slice that establishes the type, the stored shape, the name field, and the naming guarantee. Slice 02 makes the set bigger than one.

Demo: create a collation, select a verse, name it "Romans 1:1", run it, and see "Romans 1:1" — not the index identifier — in the workspace header and in the exported collation.

## Where to start

Read these before writing anything:

- `.tracker/collation-segments/SPEC.md` — Problem Statement and Implementation Decisions. Do not re-derive the design; it is settled.
- `app/src/lib/client/collation/collation-document.ts` — the setup shape carrying `selectedVerse`, `selectedBook`, `selectedChapter`, `selectedVerseNum` (lines ~116-180 and ~442-480). These four fields are what the segment replaces.
- `app/src/lib/client/store/formats/collation.ts` — `COLLATION_CURRENT_VERSION` (line 18) and the registered `DocumentUpgrader`. This is the format registration to update in place.
- `app/src/lib/components/collation/SetupPhase.svelte` — verse list, filter, and selection (lines ~45-110, ~440-455). Where the name field goes.
- `app/src/lib/components/collation/CollationWorkspace.svelte:257` — renders `selectedVerse.identifier` today. This is one of the places the name must replace.
- `app/src/lib/client/collation/collation-runner.ts` — `gatherWitnessesForVerse` (line ~700). It is **not** modified in this slice; the segment's single member is passed through to it.
- `app/src/lib/client/collation/collation-document.spec.ts` — prior art for round-trip specs.
- `CONTEXT.md`, Collation section — the vocabulary entry goes in before any code uses the term.

## Contract

**The type.**

```ts
interface CollationSegment {
	id: string;
	name: string;      // scholar-supplied; required; never derived
	members: string[]; // verse index identifiers, verbatim
}
```

**Members are opaque.** A member is a verse index identifier stored exactly as `normalizeVerseIdentifier` produces it. It is never parsed, split, normalized, lowercased, or pattern-matched. Equality is the only operation performed on it. If this slice inspects the *contents* of a member string for anything but equality, it has gone wrong.

**The name is required and never derived.** A segment cannot be created or persisted without a name the scholar typed. There is no default, no placeholder that becomes a value, and no fallback to the member identifier — not in the UI, not in the document layer, not in export. This is the single most important constraint in the epic: the guarantee that no internal identifier reaches a published apparatus is only as strong as the absence of a code path that could produce one. Do not add "helpful" prefill.

**The name is the only reference in output.** Everywhere a collation currently displays or exports a verse identifier, it displays or exports the segment name instead. Member identifiers remain visible only in the setup screen where the scholar picks them.

**A collation carries exactly one segment**, with exactly one member in this slice. Do not build a collection, and do not add a uniqueness rule — there is never a second name to collide with.

**The format changes directly.** There are no stored collations, so `selectedVerse` / `selectedBook` / `selectedChapter` / `selectedVerseNum` are removed and the migrate-on-read registration is updated in place. **Do not write a `DocumentUpgrader` for the old shape.** If you discover a stored collation that would be broken by this, stop and raise it rather than writing a migration on assumption.

**Round-tripping is lossless.** Save then load yields the same name and the same member.

**`gatherWitnessesForVerse` is not modified and keeps its name.** It still does exactly what it is called.

## Out of scope

- Selecting more than one member — slice 02. Build no multi-select, no "add another identifier" affordance.
- Any change to which witnesses are gathered, in what order, or with what sigla.
- Orphaned-member reporting — slice 03.
- Renaming `VerseNode`, `VerseIndexRow`, `gatherVerses`, `extractWitnessTokensForVerse`, or any other `Verse`-named symbol. Their names are accurate; segments are verse-level. This is explicitly fenced in the spec.
- Deduplicating `normalizeVerseIdentifier`, which exists in three copies. Tempting and unrelated.
- Any change to the verse index, the TEI parser or serializer, the bundled Robinson-Pierpont asset, or the reference edition picker.

## Acceptance criteria

- [ ] `CONTEXT.md` has a `Collation segment` entry under Collation, with an `_Avoid_` line naming `Collation unit` and the reason (a variation unit is a place *within* a segment).
- [ ] Unit spec: a segment's name and member survive save and load unchanged.
- [ ] Unit spec: creating or persisting a segment with an empty or missing name is rejected.
- [ ] Unit spec: a one-member segment gathers exactly the witnesses the per-identifier path gathers for that identifier, in the same order, with the same sigla.
- [ ] The workspace cites the segment name; a collation whose member is `B06 B06K1:B06K1V1` and whose name is `Romans 1:1` shows `Romans 1:1`.
- [ ] Exported collation output contains the segment name and does not contain the member identifier.
- [ ] `selectedVerse`, `selectedBook`, `selectedChapter`, and `selectedVerseNum` no longer appear in the collation document shape.
- [ ] `grep -rn "DocumentUpgrader" app/src/lib/client/store/formats/collation.ts` shows no upgrader added for a prior setup shape.
- [ ] `gatherWitnessesForVerse` is unchanged.

Commands:

```sh
cd app && pnpm run check && pnpm run test:unit -- --run
```

Success = both exit 0.

## Blocked by

None - can start immediately.
