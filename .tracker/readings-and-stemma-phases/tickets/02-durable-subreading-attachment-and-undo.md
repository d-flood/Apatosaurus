# 02 — Tracer bullet: subreading attachment that persists, with undo

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

The narrowest complete path that proves the epic's architecture and fixes its headline bug: a scholar attaches a **subreading** to a **main reading** whose text differs, the attachment persists across later edits, and the action can be undone.

Three failures are being fixed together because they are one failure: an **editorial decision** has no durable identity.

It has no identity of its own, because one field carries both the **reading proposal** and the decision. `setReadingParent` returns early when the target's family key differs from the reading's — family key is just normalized text — so the control offers targets it will refuse and the menu silently reverts. And `canonicalizeReadings` runs on every write to the readings collection and re-derives attachment from normalized-text equality, so even a successful attachment is erased by the next edit.

It has no durable address, because decisions are filed under the **variation unit**'s *position*. `getReadingUnitKey` (~line 2051) returns `String(normalizeVariationUnitIndex(unitIndex))` — an index into `alignmentColumns`. `mergeColumns` (~1478), `splitColumn` (~1705) and `shiftToken` (~1902) all reindex that array and touch neither `classifiedReadings` nor `stemmaEdges`. So merging one column silently re-points every decision after it onto a different unit. Fixing the first two failures without this one produces a decision that persists faithfully under the wrong unit, which is worse than one that vanishes.

Fix it by splitting the representations and giving the unit a stable identity. Introduce a sparse, persisted decision record keyed by a column-derived unit id, and a pure `applyDecisions` that combines it with the proposal on read. Attachment becomes a decision. Nothing re-derives on write.

Carry exactly one decision kind — subreading attachment — end to end: model, store command, undo, persistence, and the control in the readings phase. Later tickets add the other decision kinds along the path this establishes.

## Where to start

- The pure proposal module that ticket 01 extracted. `applyDecisions` belongs beside it as a sibling pure module, as does the unit-id helper.
- `app/src/lib/client/collation/collation-variation-units.ts` — `buildVariationUnitSpans` (~552) is the unit enumerator. Today it is degenerate: one span per variation column, `startIndex === endIndex`, `columnIds` always length 1. The unit id comes from `columnIds[0]`.
- `app/src/lib/client/collation/collation-state.svelte.ts` — `getReadingUnitKey` (~2051) and its six call sites: readings at ~2323, ~2333, ~2426; stemma at ~2765, ~2774, ~2800. Also `setReadingParent` (~2368, note the early return at ~2378), `setReadingsForUnit` (~2317, the choke point that calls `canonicalizeReadings`), `ensureReadingsForUnit`, `peekReadingsForUnit`, `getReadingFamiliesForUnit` (~2229), and `pushCommand`/`undo`/`redo` (~392).
- `app/src/lib/components/collation/StemmaPhase.svelte` — the broken control is the "Attach as subreading of" select (~line 345), fed by `getParentOptions` (~131) which offers every main reading with no family filter. **Move this control to the readings phase**; subreading attachment is a citation decision and does not belong on the stemma screen.
- `app/src/lib/components/collation/ReadingsPhase.svelte` — the "family parent" select (~line 570) is the per-group control wrongly rendered on every row of the group. It goes away in this ticket.
- `app/src/lib/client/collation/collation-document.ts` — `buildVariationUnitId` (~400) already builds `unit:${columnId}` and persists `columnId` on each apparatus node; `hydrateCollationDocument` (~521) then re-keys by `String(unit.unitIndex)` and discards it. The identity this ticket needs is already computed and thrown away on read.
- `app/src/lib/client/collation/collation-projection.ts` — `buildCollationProjectionFromDocument` (~136) looks readings up by `String(unitIndex)` at ~146 and must follow the new key.
- `app/src/lib/client/store/formats/collation.ts` — `COLLATION_CURRENT_VERSION` (currently `2`) and `COLLATION_FIXTURE`.

## Contract

### Unit identity

```ts
// pure module, beside the proposal module
export function variationUnitId(columnId: string): string; // `unit:${columnId}`
```

```ts
// store
function getReadingUnitKey(unitIndex: number): string | null;
```

- The id derives from the unit's first column id, and from nothing else. Do not incorporate the index, the reading texts, or a counter.
- `getReadingUnitKey` returns `null` when the index resolves to no column — reachable only before any alignment exists, when there are no units to address. Every caller returns early on `null` rather than substituting a fallback key.
- **Delete the `unit:index:${unitIndex}` fallback** in `buildVariationUnitId`. It is the positional escape hatch this ticket removes; leaving it means the first `null` column id silently restores the old behaviour.
- `normalizeVariationUnitIndex` keeps its positional role for `selectedUnitIndex` — selection is view state and stays an index. Only `getReadingUnitKey` changes.
- `stemmaEdges` is re-keyed by the same function, in the same change. See Out of scope.

### Decisions

```ts
type SubreadingDecisions = { subreadingOf?: Record<string, string | null> };

applyDecisions(
	proposal: ClassifiedReading[],
	decisions: UnitDecisions
): {
	readings: ClassifiedReading[];
	orphanedDecisions: OrphanedDecision[]; // decisions naming absent readings
};

findOrphanedUnitDecisions(
	decisions: ReadonlyMap<string, UnitDecisions>,
	liveUnitIds: ReadonlySet<string>
): OrphanedUnitDecision[]; // decisions naming absent units
```

Rules that must hold:

- **A recorded decision outranks the proposal.** Proposal-derived attachment applies only where no decision exists for that reading.
- **No family-key restriction.** Any reading may be attached to any other main reading in the same unit. Reject only self-attachment and cycles.
- **Nothing recanonicalizes on write.** `applyDecisions` is called on read. Attachment must survive an unrelated subsequent edit to the same unit — this is the assertion that proves the ticket.
- **Two kinds of orphan, two functions.** `applyDecisions` is per-unit and therefore structurally cannot see a decision whose *unit* is gone — nothing iterates it. `findOrphanedUnitDecisions` is the collection-level counterpart. Surface both.
- **Never prune.** No operation removes a decision from the map: not merge, not split, not shift, not re-collation, not save, not cleanup. Only an explicit scholar resolution does. The reason is not obvious and is load-bearing: `splitColumn` restores `col.splitInto` clones carrying the **original column ids** (~1713), and `undo` restores `prevColumns` clones likewise (~1730). So unmerging or undoing revives the affected decisions intact — but only if nothing deleted them meanwhile. Pruning turns a recoverable orphan into permanent loss.
- Labels remain derived: main readings take letters, subreadings take their main reading's letter plus an index (`a`, `b`, `b1`).

### Undo

- **Snapshot the decisions for the unit; do not write undo/redo closures.** Decisions are small and sparse, so a value copy is correct by construction. The existing `pushCommand` takes closures — have them close over a captured snapshot value, not over recomputation logic.
- One history entry per user gesture.
- Each entry records the phase it was made in; `undo` navigates to that phase before applying.
- In memory only. **Do not persist undo history** — project direction in `ideas.md` explicitly forbids a second persisted representation of the collation.
- Cap history around 100 entries.

### Persistence

- Decisions are persisted per unit alongside the alignment, keyed by unit id.
- Apparatus and stemma nodes carry `unitId` and **drop `unitIndex`**. Ordering comes from alignment column order, which is authoritative; a second positional field is a second key that will drift.
- **Persisted readings are derived output.** `apparatus.units[].readings` continues to be written, because the SQL projection reads it and ticket 06's renderer will want it. Nothing in the load path consults it: on load, recompute the proposal from the alignment and apply decisions. A reader who finds readings in the document will use them unless told not to — so this rule is stated, tested, and not left to inference.
- **Bump `COLLATION_CURRENT_VERSION` and register no upgrader.** The app is not deployed. The bump makes the existing forward-version guard in `migrate-on-read.ts` reject newer documents on stale builds, and makes pre-change local documents fail loudly rather than being misparsed and saved over. The key change and the decisions record ride the same bump.
- `COLLATION_FIXTURE` carries a hardcoded `content_hash`. **It must be recomputed, not hand-edited.** Add a small regeneration path; none exists today, and hand-editing produces `assertContentHashMatches` failures that look unrelated to your change.

## Out of scope

- **Surviving a re-collation.** Decisions survive hand edits to the alignment, not a re-run of the aligner. Every column id is regenerated per run (`collation-adapter.ts`, `makeId()`), so after a re-collation every decision orphans. This is not a regression — today re-collation discards readings and stemma edges outright — but it is not fixed here. Reattaching across a re-collation needs a content-derived anchor, which is a design decision of its own and belongs in its own ticket. **Do not invent one.** A wrong anchor silently reattaches a decision to the wrong unit, which is the failure this epic exists to remove. See SPEC § "Editorial decisions become the authority".
- **The stemma fence, clarified.** The parent fence — do not touch `addStemmaEdge`, `removeStemmaEdge`, `suggestStemma`, `layoutNodes`, or the SVG — covers stemma *behaviour and UI*, and still holds. Re-keying stemma storage is required by this ticket and is not a breach: the three functions call `getReadingUnitKey`, so changing what it returns re-keys `stemmaEdges` with zero edits to their bodies. Leaving the stemma positional while decisions are column-keyed would ship two keying schemes over one concept and is the worse outcome. `suggestStemma`'s majority-text root heuristic stays broken here; it is ticket 10's.
- **The lazy-init leak stays live.** `ensureReadingsForUnit` populates readings only for units the scholar has visited, so `buildCollationProjectionFromDocument`'s `?? []` still projects zero readings for unvisited units and the SQL projection still under-reports. Follow the new key; do not fix the leak. It belongs with whichever ticket makes the projection recompute — most naturally ticket 06.
- **Other decision kinds.** No reading types, lemma elevation, source decisions, ordering, or witness reassignment as decisions. Tickets 03–05. The overlay type may declare the fields; only `subreadingOf` is implemented.
- **The readings phase reframe.** Do not rebuild the table into cards, do not add chip selection or bulk verbs. Ticket 07. Here you delete the broken group control and add one working attachment control to the existing table.
- **Removing `parentReadingId` from `ClassifiedReading`.** The field remains as the *computed output* of `applyDecisions`. Only its role changes: derived, not authoritative. Renaming it is churn that will collide with tickets 03–05.
- Non-attestation handling, the reading-type control, the text-destroying omission selection. Tickets 03 and 04.
- Writing an upgrader, or preserving readability of pre-change local documents.
- Making selection, navigation, or the base-text choice undoable. **Undo covers editorial decisions only.** This is the tempting easy win that makes the undo key appear broken.

## Acceptance criteria

- [ ] A pure `applyDecisions` module exists beside the proposal module, imports no store and no Svelte runes, and returns both readings and orphaned decisions.
- [ ] A pure `variationUnitId` helper derives the unit id from a column id, and `buildVariationUnitId`'s `unit:index:` fallback is deleted.
- [ ] `getReadingUnitKey` returns a column-derived id or `null`, and all six call sites handle `null` by returning early.
- [ ] `setReadingsForUnit` no longer calls `canonicalizeReadings`; canonicalization is not invoked on write anywhere.
- [ ] Attaching a subreading to a main reading with **different normalized text** succeeds.
- [ ] A store spec asserts an attachment survives a subsequent unrelated edit to the same unit.
- [ ] A store spec asserts that merging two columns leaves decisions on **every other unit** untouched — this is the assertion the positional key fails.
- [ ] A store spec asserts the revival round-trip: merge two units, confirm their decisions are reported orphaned, unmerge, confirm the decisions apply again. A second spec asserts the same for undo.
- [ ] `findOrphanedUnitDecisions` reports a decision whose unit is gone, and no code path deletes a decision from the map.
- [ ] Self-attachment and cycle creation are rejected, and the rejection is observable to the caller rather than a silent return.
- [ ] A decision naming a removed reading appears in `orphanedDecisions` rather than vanishing.
- [ ] Undoing an attachment restores the previous state in one step; redo reapplies it.
- [ ] Undo history is not present in the persisted document.
- [ ] Corrupting `apparatus.units[].readings` in a fixture changes nothing observable after load — proving persisted readings are output, not truth.
- [ ] Apparatus and stemma nodes persist `unitId` and no `unitIndex`; `buildCollationProjectionFromDocument` looks up by unit id.
- [ ] The misplaced attachment control is gone from the stemma phase, and the per-group control is no longer rendered per row in the readings phase.
- [ ] `COLLATION_CURRENT_VERSION` is bumped, no new upgrader is registered, and the fixture's `content_hash` is regenerated rather than hand-written.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm lint
pnpm check
```

To verify by hand: `pnpm run dev`, open a collation with at least two readings of differing text, attach one as a subreading of the other, then edit a different reading's text in the same unit. The attachment must still be there. Now merge two columns elsewhere in the alignment and confirm the attachment is still on its own unit. Press undo and the merge reverses. Press undo again and the attachment reverses.

## Blocked by

- Ticket 01
