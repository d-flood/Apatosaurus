# 04 — Reading types and certainty

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

Give readings a **reading type** — an evidential qualifier that stands on its own without reference to any other reading: that it is an omission, too damaged to identify, only apparently this text, or not meaningful Greek. Its purpose is honest citation and *filterability* during later analysis. Add **certainty** as a separate, orthogonal field.

Three things are being fixed:

1. **The existing control is incoherent between read and write.** It reports `ns` when a reading has a parent, but writing `ns` sets a type without attaching anything, and writing the neutral option does not detach a subreading. It also conflates a fact about the text (`om`, `lac` — which the aligner already determined) with an editorial judgement (`ns`).
2. **Selecting the omission option silently destroys reading text**, nulling both the original and normalized text with no confirmation and no recovery.
3. **`ReadingClassification` is modelled on the wrong axis.** `omit`, `add`, `substitute`, `transpose` describe one reading *relative to another* and cannot be properties of a reading. `orthographic` describes the relationship a subreading now expresses. `omit` duplicates `isOmission`. The field is read only to tint SVG nodes.

Split the axis: absolute qualifiers become the reading type; relational categories are **removed, not relocated** — they belong on the arc, which is out of scope for this epic.

## Where to start

- `app/src/lib/client/collation/collation-state.svelte.ts` — `setReadingEditorType` (~2477) is where selecting omission nulls `text` and `normalizedText` (~2488). `classifyReading` (~2323) is the classification setter to remove.
- `app/src/lib/components/collation/ReadingsPhase.svelte` — `readingEditorType()` (~137) is the incoherent read side; the Type select is ~515.
- `app/src/lib/components/collation/StemmaPhase.svelte` — `classifications`, `classColors`, `classNodeColors` (~34–59) and the classification select (~324). All go.
- `app/src/lib/client/collation/collation-types.ts` — `ReadingClassification` and `ReadingEditorType`; `readingType` is currently typed `RegularizationType | null`, i.e. only `'ns'`, which is the field to widen.
- `app/src/lib/client/collation/collation-types.ts` — `WitnessTextSegment` carries `hasUnclear` and `isSupplied`, and `RegularizedToken` carries `types`. **These are the signals to propose types from.**
- `app/src/lib/client/collation/regularization.ts` — regularization rules already carry a `'ns'` type, and readings carry `derivedFromRuleIds`. A rule typed `ns` firing on a reading is a proposal that the reading is nonsense.
- `NT_Manuscripts_TEI_Schema/TEI-NTMSS.rng` — `@type` on `<rdg>` comes via `att.textCritical` and is **open-valued**; `@cert` reaches `<rdg>` via `att.global` → `att.global.responsibility` with values `high | medium | low | unknown` or a double. Both are schema-legal.

## Contract

```ts
type ReadingTypeId = string;          // open vocabulary, project-extensible
type Certainty = 'high' | 'medium' | 'low' | 'unknown' | number;

// decisions overlay gains:
readingType?: Record<string, ReadingTypeId | null>;
certainty?:   Record<string, Certainty | null>;
```

Rules:

- **Single-valued.** One reading type per reading, because TEI `@type` is a single token and a set has no faithful serialisation. Certainty carries the "apparent" axis if it is a confidence claim rather than a type.
- **Open, project-extensible vocabulary.** Bundle the standard values (omission, deficient, apparent, nonsense, orthographic) and allow a project to add its own. A closed enum missing one value forces a migration.
- **Proposed, then decided.** The proposal derives a likely type from existing per-segment `hasUnclear` / `isSupplied` markers and from `ns`-typed regularization rules that fired. A recorded decision always outranks the proposal, following the pattern ticket 02 established.
- **`om` and `lac` are not editorial type choices.** Omission is determined by the aligner. Lacuna is non-attestation and not a reading at all after ticket 03. Neither appears as a user-selectable type. The control offers only genuine editorial judgements.
- **Changing a type must never destroy reading text.** If an action would discard text, confirm first; and because the action is undoable via ticket 02's mechanism, prefer making it reversible over making it loud.
- `ReadingClassification` is deleted. Stemma node colour encodes **source-decision state** instead (ticket 08 owns that); until then, colour by reading type or drop the tinting.
- A subreading with no reading type is a Review-phase nudge, not an error. Record the condition; ticket 11 surfaces it.

## Out of scope

- **Relational typology** (`add`, `substitute`, `transpose`). Deleted, not reimplemented anywhere. Do not add an arc label for it — arcs do not exist yet and that is a future epic.
- Serialising `@type` or `@cert`. Ticket 11 owns export. Here the data must merely be complete enough for it.
- Export filtering by type. Ticket 11.
- Changing tokenization or regularization to produce better signals. Use the markers that exist.
- The readings phase reframe. Replace the one broken control in the existing table; do not rebuild the table. Ticket 07.
- Reading-type vocabulary *editing UI* at project level. Ship the bundled vocabulary plus a data path for project additions; a settings screen for managing them is not in this epic.
- Touching non-attestation handling. Ticket 03 owns it.

## Acceptance criteria

- [ ] `readingType` accepts the full vocabulary rather than only `'ns'`, and `certainty` exists as a separate field.
- [ ] `ReadingClassification`, its setter, and all node tinting derived from it are removed from the codebase.
- [ ] The reading-type control reports exactly what it writes — a spec asserts read-back equals what was set, for every vocabulary value.
- [ ] Setting a type never nulls `text` or `normalizedText`; a spec asserts text survives every type change.
- [ ] Any action that would discard reading text requires confirmation and is undoable.
- [ ] A reading whose segments carry unclear or supplied markers receives a proposed type without the scholar acting.
- [ ] A reading a `ns`-typed regularization rule fired on receives a proposed nonsense type.
- [ ] A recorded reading-type decision survives a subsequent unrelated edit to the same unit.
- [ ] Neither omission nor lacuna appears as a selectable editorial type.
- [ ] A project-supplied type value round-trips through the store and the persisted document.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm lint
pnpm check
```

To verify by hand: `pnpm run dev`, open a unit containing a partially-legible witness — its reading should already carry a proposed deficient type. Change a reading's type and confirm its text is unchanged. Search the codebase for `ReadingClassification` and find nothing.

## Blocked by

- Ticket 02
