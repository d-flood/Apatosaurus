# 02 — Tracer bullet: subreading attachment that persists, with undo

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

The narrowest complete path that proves the epic's architecture and fixes its headline bug: a scholar attaches a **subreading** to a **main reading** whose text differs, the attachment persists across later edits, and the action can be undone.

Two failures are being fixed together because they have one cause. `setReadingParent` returns early when the target's family key differs from the reading's — and family key is just normalized text — so the control offers targets it will refuse, and the menu silently reverts. Separately, `canonicalizeReadings` runs on every write to the readings collection and re-derives attachment from normalized-text equality, so even a successful attachment is erased by the next edit. One field is carrying both the **reading proposal** and the **editorial decision**.

Fix it by splitting the representations. Introduce a sparse, persisted **editorial decision** record and a pure `applyDecisions` that combines it with the proposal on read. Attachment becomes a decision. Nothing re-derives on write.

Carry exactly one decision kind — subreading attachment — end to end: model, store command, undo, persistence, and the control in the readings phase. Later tickets add the other decision kinds along the path this establishes.

## Where to start

- The pure proposal module that ticket 01 extracted. `applyDecisions` belongs beside it as a sibling pure module.
- `app/src/lib/client/collation/collation-state.svelte.ts` — `setReadingParent` (~line 2368, note the early return at 2378), `setReadingsForUnit` (~2317, the choke point that calls `canonicalizeReadings`), `ensureReadingsForUnit`, `peekReadingsForUnit`, `getReadingFamiliesForUnit` (~2229), and `pushCommand`/`undo`/`redo` (~392).
- `app/src/lib/components/collation/StemmaPhase.svelte` — the broken control is the "Attach as subreading of" select (~line 345), fed by `getParentOptions` (~131) which offers every main reading with no family filter. **Move this control to the readings phase**; subreading attachment is a citation decision and does not belong on the stemma screen.
- `app/src/lib/components/collation/ReadingsPhase.svelte` — the "family parent" select (~line 570) is the per-group control wrongly rendered on every row of the group. It goes away in this ticket.
- `app/src/lib/client/collation/collation-document.ts` — `classifiedReadings` is persisted via `apparatus.units[].readings`. Decisions need a home here.
- `app/src/lib/client/store/formats/collation.ts` — `COLLATION_CURRENT_VERSION` (currently `2`) and `COLLATION_FIXTURE`.

## Contract

```ts
type SubreadingDecisions = { subreadingOf?: Record<string, string | null> };

applyDecisions(
  proposal: ClassifiedReading[],
  decisions: UnitDecisions
): {
  readings: ClassifiedReading[];
  orphanedDecisions: OrphanedDecision[];   // decisions naming absent readings
};
```

Rules that must hold:

- **A recorded decision outranks the proposal.** Proposal-derived attachment applies only where no decision exists for that reading.
- **No family-key restriction.** Any reading may be attached to any other main reading in the same unit. Reject only self-attachment and cycles.
- **Nothing recanonicalizes on write.** `applyDecisions` is called on read. Attachment must survive an unrelated subsequent edit to the same unit — this is the assertion that proves the ticket.
- **Orphaned decisions are reported, not dropped.** A decision naming a reading absent from the current proposal is returned in `orphanedDecisions`. Do not silently filter it.
- Labels remain derived: main readings take letters, subreadings take their main reading's letter plus an index (`a`, `b`, `b1`).

Undo:

- **Snapshot the decisions for the unit; do not write undo/redo closures.** Decisions are small and sparse, so a value copy is correct by construction. The existing `pushCommand` takes closures — have them close over a captured snapshot value, not over recomputation logic.
- One history entry per user gesture.
- Each entry records the phase it was made in; `undo` navigates to that phase before applying.
- In memory only. **Do not persist undo history** — project direction in `ideas.md` explicitly forbids a second persisted representation of the collation.
- Cap history around 100 entries.

Persistence:

- Decisions are persisted per unit alongside the alignment.
- **Bump `COLLATION_CURRENT_VERSION` and register no upgrader.** The app is not deployed. The bump makes the existing forward-version guard in `migrate-on-read.ts` reject newer documents on stale builds, and makes pre-change local documents fail loudly rather than being misparsed and saved over.
- `COLLATION_FIXTURE` carries a hardcoded `content_hash`. **It must be recomputed, not hand-edited.** Add a small regeneration path; none exists today, and hand-editing produces `assertContentHashMatches` failures that look unrelated to your change.

## Out of scope

- **Other decision kinds.** No reading types, lemma elevation, source decisions, ordering, or witness reassignment as decisions. Tickets 03–05. The overlay type may declare the fields; only `subreadingOf` is implemented.
- **The readings phase reframe.** Do not rebuild the table into cards, do not add chip selection or bulk verbs. Ticket 07. Here you delete the broken group control and add one working attachment control to the existing table.
- **Removing `parentReadingId` from `ClassifiedReading`.** The field remains as the *computed output* of `applyDecisions`. Only its role changes: derived, not authoritative. Renaming it is churn that will collide with tickets 03–05.
- Non-attestation handling, the reading-type control, the text-destroying omission selection. Tickets 03 and 04.
- Anything on the stemma phase beyond deleting the misplaced attachment control. Do not touch `addStemmaEdge`, `removeStemmaEdge`, `suggestStemma`, `layoutNodes`, or the SVG.
- Writing an upgrader, or preserving readability of pre-change local documents.
- Making selection, navigation, or the base-text choice undoable. **Undo covers editorial decisions only.** This is the tempting easy win that makes the undo key appear broken.

## Acceptance criteria

- [ ] A pure `applyDecisions` module exists beside the proposal module, imports no store and no Svelte runes, and returns both readings and orphaned decisions.
- [ ] `setReadingsForUnit` no longer calls `canonicalizeReadings`; canonicalization is not invoked on write anywhere.
- [ ] Attaching a subreading to a main reading with **different normalized text** succeeds.
- [ ] A store spec asserts an attachment survives a subsequent unrelated edit to the same unit.
- [ ] Self-attachment and cycle creation are rejected, and the rejection is observable to the caller rather than a silent return.
- [ ] A decision naming a removed reading appears in `orphanedDecisions` rather than vanishing.
- [ ] Undoing an attachment restores the previous state in one step; redo reapplies it.
- [ ] Undo history is not present in the persisted document.
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

To verify by hand: `pnpm run dev`, open a collation with at least two readings of differing text, attach one as a subreading of the other, then edit a different reading's text in the same unit. The attachment must still be there. Press undo twice and both changes reverse in order.

## Blocked by

- Ticket 01
