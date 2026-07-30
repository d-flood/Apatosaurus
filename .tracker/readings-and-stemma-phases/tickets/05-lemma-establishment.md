# 05 — Lemma establishment

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

Make the **lemma reading** — the reading established as `a` at a variation unit — something a scholar discovers rather than something the base text dictates. During a collation the base text is a starting hypothesis; the set of established lemma readings *is* the edition being built, so a scholar must be able to elevate any reading to `a`, which bumps the base text's reading down into the ordinary letter sequence.

Today `a` is definitionally the base text's reading: ordering puts the base-text reading first, and there is no way to establish an edition that departs from the base text at any point.

Three cases must work:

- **Default.** No decision recorded: the lemma is the reading the base text attests. This is the common case and requires no scholar action.
- **Elevated.** A scholar names a different reading as the lemma. It becomes `a`; the base-text reading keeps its place in the sequence rather than disappearing, because it is what the scholar is comparing against.
- **No base-text testimony.** After ticket 03 the base text may be non-attesting, and it may also be excluded. There is then no default lemma. The app must **not** promote the majority reading — that fabricates a lemma from witness counts. It marks the unit as needing a lemma decision and lets the scholar designate one.

Also produce the **divergence** data: the units where the established lemma departs from what the base text attests. It costs nothing to compute and it is what tells a scholar what their edition actually claims.

## Where to start

- `app/src/lib/client/collation/collation-state.svelte.ts` — `compareReadingsForPriority` (~1998) puts the base-text reading first, then orders by witness count descending, then alphabetically. This is what lemma elevation must override. `getBaseWitnessId` and `getBaseTextForVariationUnit` (~1968) are the base-text accessors. `setBaseText` is the Setup-phase decision and is **not** what this ticket changes.
- The proposal module from ticket 01 — `relabelReadings` assigns letters from order, so establishing the lemma is an ordering decision expressed as a lemma decision, not a relabelling hack.
- `app/src/lib/components/collation/ReadingsPhase.svelte` — the reorder carets (~479) and `moveReadingUp`/`moveReadingDown` (~255). Reordering stays but stops being the primary ordering gesture; note that `moveReadingBefore` in the store (~2635) silently refuses cross-group drops with a bare `return`, which must start explaining itself.
- `example_collation.xml` at the repo root — every `<app>` has exactly one `<lem>`, and reading `a` always includes `basetext` in `@wit`. That invariant is an artifact of a collation that agreed throughout, **not** a constraint to preserve. This ticket deliberately makes it breakable.

## Contract

```ts
// decisions overlay gains:
lemmaReadingId?: string | null;   // absent/null = derive from the base text
```

Rules:

- **Ordering.** The lemma reading is `a`. Remaining readings order base-text-reading first, then witness count descending, then alphabetically — so the base text stays prominent even when it is not the lemma.
- **Elevation never rewrites arcs.** A local stemma may already exist. Elevating the lemma is a labelling decision and must not silently restructure a genealogical one. Ticket 10 owns the resulting contradiction warning.
- **No base-text testimony:** order readings provisionally by witness count so the screen is usable, and report the unit as *needs a lemma decision*. Do not treat the provisional first reading as the lemma.
- **Divergence** is derived, not stored: the set of units where the effective lemma reading is not the reading the base text attests. Expose it from the store; ticket 11 renders it.
- Elevation is one action, undoable via ticket 02's mechanism.
- Manual reordering of `b`, `c`, `d`… remains available but moves out of the primary position. When a reorder is refused, the refusal must be reported to the caller rather than swallowed.

## Out of scope

- **Changing which witness is the base text.** That is `setBaseText`, a Setup-phase decision, and it is not touched here.
- **A reconstructed initial text as a first-class entity** — an `a` attested by no witness at all, in the full CBGM sense. Elevation selects among existing readings. Introducing a hypothetical reading is a larger model change and is not in this epic.
- The lemma-as-root default for local stemmata, the contradiction warning, and the reroot repair. Tickets 08 and 10.
- Rendering the divergence report. Ticket 11. Here you expose the data.
- Serialising `<lem>` and its `@wit`. Ticket 11.
- The readings phase reframe. Add the elevation action to the existing table; do not rebuild it. Ticket 07.
- Removing manual reordering. It stays.

## Acceptance criteria

- [ ] With no decision recorded, the lemma is the reading the base text attests, and that reading is labelled `a`.
- [ ] Elevating another reading makes it `a`, and the base-text reading remains present with a letter rather than disappearing.
- [ ] After elevation the base-text reading sorts ahead of other non-lemma readings.
- [ ] A lemma decision survives a subsequent unrelated edit to the same unit.
- [ ] Elevation is undoable in one step.
- [ ] Where the base text does not attest, no reading is treated as the lemma, the unit is reported as needing a lemma decision, and readings are still ordered and displayed.
- [ ] Designating a lemma at such a unit satisfies the condition and clears the report.
- [ ] Where the base text is excluded, the same path applies as for non-attestation.
- [ ] Divergence is queryable from the store and lists exactly the units where the lemma is not the base text's reading.
- [ ] Elevating the lemma leaves any existing arcs for that unit byte-identical.
- [ ] A refused reorder reports the refusal rather than returning silently.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm lint
pnpm check
```

To verify by hand: `pnpm run dev`, open a unit with three or more readings, elevate the second reading to lemma. It becomes `a`; the base text's reading is still listed and sorts first among the rest. Undo returns to the derived lemma.

## Blocked by

- Ticket 02
