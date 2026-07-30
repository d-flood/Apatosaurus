# 01 — Prefactor: extract the reading proposal as a pure module

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

A pure module that produces the **reading proposal** for a variation unit, extracted out of the collation state store with **no behaviour change**. This is a prefactor: it makes every later ticket in the epic a small change instead of a large one. Nothing a scholar can see changes, and every existing test must still pass without being rewritten.

Today the store owns proposal-building and re-derivation together: `buildReadingsForUnit` builds readings from alignment columns, then `canonicalizeReadings` re-imposes subreading structure from normalized-text equality, then `normalizeReadingOrders` and `relabelReadings` assign order and labels. These are pure computations tangled into a 3000-line store that also owns persistence, phase navigation, undo, and witness refresh. Move them out as-is.

Do **not** change what they compute. In particular, `canonicalizeReadings` currently re-derives subreading attachment on every write, which is the bug ticket 02 fixes. Move that behaviour intact. If you fix it here, ticket 02 has no tracer bullet and this prefactor becomes unreviewable.

## Where to start

- `app/src/lib/client/collation/collation-state.svelte.ts` — the source. The functions to move are contiguous-ish around lines 1990–2230: `getReadingFamilyKey`, `compareReadingsForPriority`, `compareReadingsForOrder`, `buildClassifiedReadingsFromFamilyGroups`, `canonicalizeReadings`, `normalizeReadingOrders`, `relabelReadings`, `buildReadingsForUnit`, and the `indexToReadingLabel` helper they use.
- `app/src/lib/client/collation/collation-variation-units.ts` — already a pure module doing the adjacent job (`buildReadingFamilyGroups`, `buildVariationUnitSpans`). This is the prior art for style, and the natural neighbour for the new module. Read it first.
- `app/src/lib/client/collation/collation-variation-units.spec.ts` — the prior art for the spec.
- `app/src/lib/client/collation/collation-types.ts` — `ClassifiedReading` lives here and does not change in this ticket.

Note the awkward dependency you must break: several of these functions call `getBaseWitnessId()` and read `alignmentColumns` from the store's closure. Pass those in as arguments instead. That is the entire point of the extraction.

## Contract

The new module must not import the store, must not reference `$state`/`$derived`, and must take and return plain data:

```ts
buildReadingProposal(input: {
  columns: AlignmentColumn[];        // the columns for one variation unit
  spanColumnIds: string[];
  sourceWitnessIds: string[];        // ordered active witnesses
  baseWitnessId: string | null;
}): ClassifiedReading[];
```

Keep `canonicalizeReadings`, `relabelReadings`, and the comparators exported from the module too — the store still calls them on write today, and ticket 02 is what removes that. Their signatures take `baseWitnessId` explicitly rather than closing over it.

`ClassifiedReading` is unchanged in this ticket. No field added, renamed, or removed.

## Out of scope

- **Any behaviour change at all.** No bug fixes, including the `setReadingParent` family-key early return, the incoherent reading-type control, or the destroyed reading text. Those are tickets 02 and 04.
- Introducing the decisions overlay or `applyDecisions`. Ticket 02.
- Touching `parentReadingId`, `ReadingFamilyView`, or `ReadingClassification`. Later tickets remove these; removing them here couples the prefactor to the redesign.
- Touching the stemma functions (`addStemmaEdge`, `removeStemmaEdge`, `suggestStemma`) or `StemmaPhase.svelte`.
- Touching `ReadingsPhase.svelte`. If the extraction is done right, no component changes.
- Changing the persisted document shape or the format version. Ticket 02.
- Rewriting existing specs to match a new structure. If an existing spec needs changing, the extraction changed behaviour — that is the signal to stop and reconsider, not to edit the test.
- Reformatting or reorganising unrelated parts of the store while you are in there.

## Acceptance criteria

- [ ] A new pure module beside `collation-variation-units.ts` exports `buildReadingProposal` plus the canonicalization, labelling, and comparator functions moved out of the store.
- [ ] The new module imports nothing from `collation-state.svelte.ts` and contains no Svelte runes.
- [ ] The store calls into the new module and no longer contains its own copies of the moved functions.
- [ ] A spec for the new module covers: proposal built from a multi-witness unit, subreading grouping by normalized text, label assignment (`a`, `b`, `b1`), base-text-first ordering, and omission and lacuna handling as they behave today.
- [ ] Every pre-existing spec passes **unmodified**. No existing test file is edited.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm lint
pnpm check
```

Success: the server project reports the new module's spec passing alongside all pre-existing collation specs; `git diff --stat` shows no changes to any pre-existing `*.spec.ts` file.

## Blocked by

None - can start immediately.
