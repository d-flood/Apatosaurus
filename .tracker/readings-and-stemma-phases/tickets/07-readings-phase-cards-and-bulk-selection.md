# 07 — Readings phase reframe: cards and bulk witness selection

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

Reframe the readings phase from a table of rows into **partitioning witnesses among readings**. Readings become cards anchored by their letter; subreadings nest visually inside their main reading; reading text is edited in place. Witness sigla become selectable chips in **one selection group spanning every card**, and the verbs act on the whole selection: move to a reading, split into a new reading, merge readings.

The current screen presents eight competing controls per row and no primary one: reorder carets, an implicit drag target, a type control, a text input, an add-subreading button, a group control wrongly rendered per row, per-witness reassign buttons, and delete. By this ticket, earlier tickets have already removed or fixed the broken ones. What remains is to stop making a scholar assemble common operations out of primitives.

The operation that matters most is bulk. Reassigning witnesses is currently one witness at a time through a menu, so moving nine witnesses out of a wrongly-grouped reading costs nine find-and-select interactions. The actual task is *"these nine belong to b"* — one gesture.

**Cross-card selection is the load-bearing requirement.** Selecting witnesses from two different readings and merging or moving them together is what lets a scholar gather a reading the alignment split apart. A per-card selection model cannot express it.

## Where to start

- `app/src/lib/components/collation/ReadingsPhase.svelte` — the whole component, ~700 lines. Read it fully first. The parts worth keeping: the basetext strip (now fed by ticket 06's shared module) and the unit-selection behaviour. The table body is what goes.
- `app/src/lib/client/collation/collation-state.svelte.ts` — the single-witness operations to generalise: `moveWitnessToReading` (~2564), `splitWitnessFromReading` (~2334), `addReading` (~2515), `deleteReading`. Bulk variants are needed; keep or remove the singular forms as call sites dictate.
- `app/src/lib/components/collation/AlignmentGrid.svelte` — prior art for keyboard navigation and cell selection in this codebase (`toggleCellSelection`, `selectCellRange`, `clearCellSelection` in the store). Follow its conventions rather than inventing new ones.
- `app/vite.config.ts` — **any new `phosphor-svelte/lib/*` icon must be added to `optimizeDeps.include`.** Undeclared deps are discovered mid-run and cause flaky "Failed to fetch dynamically imported module" failures in browser tests. This is a documented repo rule in `AGENTS.md`.

## Contract

Store operations, all one undo step each:

```ts
moveWitnessesToReading(unitIndex: number, witnessIds: string[], targetReadingId: string): void;
splitWitnessesIntoNewReading(unitIndex: number, witnessIds: string[], options?: { subreadingOf?: string }): void;
mergeReadings(unitIndex: number, sourceReadingIds: string[], targetReadingId: string): void;
```

Selection and keyboard:

- Witness chips form **one roving-tabindex group across all cards** — a single tabstop for the group, arrow keys to move within it, `Space` to toggle, `Shift`+arrow to extend a range, `Escape` to clear. Not one tabstop per chip; a 100-witness unit must not create 100 tabstops.
- Verbs are reachable by keyboard, announced, and available from the contextual bar when a selection exists.
- **Non-attestation witnesses are not selectable** (ticket 03). There is nothing to move them to.
- Selection state is **not undoable** (ticket 02's fence). Making it undoable is the tempting easy win that makes the undo key appear broken.

Presentation:

- Reading text is edited in place — click or focus to edit, commit on blur — not a permanently-bordered input per row. Commit on blur preserves ticket 02's undo coalescing; do not switch to per-keystroke commits.
- Subreadings render inside their main reading's card with a clear visual relationship, not as sibling rows offset by padding.
- Rare operations — reorder, delete, add subreading, set type, elevate to lemma — live in a per-card menu.
- Deletion remains blocked while a reading has attesting witnesses, with the reason stated.

## Out of scope

- **Any new decision kind or model change.** Tickets 03, 04, and 05 own the model. This ticket is presentation and interaction over an existing model. If you find yourself editing the store's decision handling, stop.
- The apparatus preview and the segment module. Ticket 06 built them; consume them.
- The stemma phase. Tickets 08–10.
- The Review phase, export, the divergence report, the worklist. Ticket 11.
- Drag-and-drop of witness chips. Selection plus verbs is the contract; chip dragging is an optional accelerator and not required here. Do not build it at the cost of the keyboard path.
- Restyling the workspace shell, header, stepper, or autosave indicator.
- Introducing a component library or a new state-management pattern.
- Virtualising long witness lists unless a unit with 100+ witnesses is demonstrably slow; if it is, say so and keep the existing show-more affordance.

## Acceptance criteria

- [ ] Readings render as cards with the label as the primary anchor; subreadings render nested inside their main reading's card.
- [ ] Reading text is edited in place and commits on blur.
- [ ] Witness chips are selectable, and a selection can span more than one card.
- [ ] Selecting witnesses across two readings and moving them to a third succeeds in one action and one undo step.
- [ ] Splitting a multi-witness selection into a new reading succeeds in one action.
- [ ] Merging two readings succeeds in one action, and the merged reading holds the union of their witnesses.
- [ ] The chip group is a single tabstop; `Tab` from before the group lands once and arrow keys move within it.
- [ ] `Space` toggles a chip, `Shift`+arrow extends, `Escape` clears — all without a pointer.
- [ ] Every bulk verb is invocable from the keyboard and announces its result.
- [ ] Non-attestation witnesses cannot be selected.
- [ ] Selection changes do not create undo entries.
- [ ] Rare operations are present in a per-card menu and absent from the card's primary surface.
- [ ] Any newly imported icon is registered in `optimizeDeps.include`.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm lint
pnpm check
```

Store-level behaviour (bulk moves, splits, merges, undo granularity) is asserted in the server project. The keyboard contract is covered by the epic's Playwright spec in ticket 11; if that spec does not exist yet, add the keyboard assertions to a new `e2e/collation-editorial-phases.spec.ts` here and let ticket 11 extend it:

```sh
pnpm exec playwright test e2e/collation-editorial-phases.spec.ts
```

To verify by hand: `pnpm run dev`, open a unit with several readings, select witnesses from two different readings with `Shift`-click, move them to a third reading in one action, then undo once and confirm all of them return.

## Blocked by

- Ticket 06
