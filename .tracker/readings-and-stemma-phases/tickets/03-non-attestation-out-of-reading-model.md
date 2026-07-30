# 03 — Non-attestation lifted out of the reading model

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

Stop treating a lacuna as a reading. Witnesses whose text is damaged, lost, or illegible do not testify at a variation unit: they are **non-attestation**. They take no letter, never enter witness-count ordering, cannot be a main reading or hold subreadings, and never become a node in a local stemma. They remain visible, because a scholar must be able to see who is absent.

Two distinctions the current model collapses must be preserved:

- **Deficient text remains a reading.** Something survives, but not enough to identify what it was. It keeps a letter and takes a **reading type** so later analysis can filter it. This is precisely what distinguishes it from non-attestation, and today they are indistinguishable.
- **An untranscribed witness is not damage.** It is a fact about project progress. It must never be reported as non-attestation, because that asserts damage to a manuscript that may not exist. It is tracked separately and reported as incomplete work.

An **omission** stays a reading. It takes a letter and may stand at either end of an arc. Omission currently wins over lacuna in the proposal, and that precedence is correct — keep it.

## Where to start

- `app/src/lib/client/collation/collation-variation-units.ts` (~lines 296–330) — where `isOmission` and `isLacuna` are derived per reading bucket. Note `isLacuna` requires no cell to have text and at least one cell to be lacunose, and that omission takes precedence.
- `app/src/lib/client/collation/collation-types.ts` — `AlignmentCellKind` already distinguishes `'gap' | 'untranscribed' | 'omission'`, and `GapMetadata.source` distinguishes `'gap' | 'untranscribed' | 'supplied'`. **The information you need already exists** and is being thrown away at the reading level.
- `app/src/lib/client/collation/alignment-snapshot.ts` (~line 76) — where `isLacuna` is flattened to kind `'gap'`, losing the untranscribed/gap distinction. This is the lossy step.
- The proposal module from ticket 01 — `relabelReadings` currently hands lacunae an ordinary letter via `indexToReadingLabel`, and `canonicalizeReadings` keeps them as main readings because `shouldBeSubreading` excludes them.
- `app/src/lib/client/collation/collation-state.svelte.ts` — `compareReadingsForPriority` (~1998) counts witnesses, which lacunose witnesses must no longer inflate.
- `app/src/lib/components/collation/ReadingsPhase.svelte` — the table body renders all readings uniformly; non-attestation needs its own pinned presentation.

## Contract

The proposal returns non-attestation separately from readings:

```ts
buildReadingProposal(input): {
  readings: ClassifiedReading[];          // no lacuna entries
  nonAttestation: {
    witnessIds: string[];                 // gap + supplied
    untranscribedWitnessIds: string[];    // held separate — never exported as lacuna
  };
};
```

Rules:

- Non-attesting witnesses are excluded from lettering, from `varSeq`-style ordering, and from the witness counts that drive ordering.
- Non-attestation cannot be a subreading target and cannot itself be attached.
- Deficient readings are ordinary readings. This ticket does not implement the reading-type vocabulary (ticket 04) — it must simply not destroy the underlying damage/uncertainty signal that ticket 04 will read.
- `untranscribedWitnessIds` is surfaced through the store so later tickets can block export on it. This ticket does not implement export gating.
- Presentation: one non-attestation row per unit, pinned last, visually distinct from readings. Its witnesses are **not selectable** for move or merge operations — there is nothing to move them to, since they have no text.

## Out of scope

- The reading-type vocabulary, the `@type` attribute, and certainty. Ticket 04. Here you only preserve the signal.
- Export, the reserved lacuna label, and export gating on untranscribed witnesses. Ticket 11.
- Chip selection and bulk verbs. Ticket 07. Non-attestation witnesses being unselectable is a property to honour when ticket 07 adds selection; here they are simply rendered plainly.
- Excluding non-attestation from stemma nodes in the UI. Ticket 08 owns the stemma; this ticket ensures the data makes it impossible.
- Changing tokenization, the aligner, or how cells are classified upstream. The distinctions already exist — stop flattening them.
- Deleting `isLacuna` from `ClassifiedReading` if other code still reads it; leave the field and stop producing lacuna *readings*.

## Acceptance criteria

- [ ] The proposal returns non-attestation separately, with gap/supplied and untranscribed witnesses in distinct collections.
- [ ] No reading in a proposal has `isLacuna` true.
- [ ] A unit where one witness is lacunose produces the same letters for the remaining readings as a unit where that witness is simply absent.
- [ ] Lacunose witnesses do not affect reading order — a spec asserts ordering is unchanged when a lacunose witness is added.
- [ ] Attempting to attach non-attestation as a subreading, or attach a subreading to it, is rejected.
- [ ] An omission still takes a letter and is still a reading.
- [ ] Untranscribed witnesses are reachable from the store separately from gap/supplied witnesses.
- [ ] The readings phase shows a distinct, pinned non-attestation row listing absent witnesses.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm lint
pnpm check
```

Success: proposal specs assert lacuna-free readings and stable lettering; store specs assert ordering is unaffected by lacunose witnesses.

## Blocked by

- Ticket 02
