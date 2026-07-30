# 09 — Stemma graph interaction: drag, keyboard lift-and-place, announcements

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

Make the local stemma diagram directly editable by two more routes that write the **same single operation** ticket 08 established: dragging a reading onto its prior reading, and lifting a reading by keyboard, moving to its prior reading, and placing it. Both are accelerators over the list editor, which remains the guaranteed route.

This is where the drag-versus-keyboard tension is resolved, and the resolution is already built: because ticket 08's layout module owns all geometry, dragging can only mean *reparenting*, never positioning. A tree reparent has an exact keyboard equivalent — the bargain a file tree makes. There is no accessible-drag problem left to solve, only an accessible-drag implementation to write.

The current diagram is inaccessible by construction: nodes are SVG `<g>` elements with `onclick` handlers and `svelte-ignore a11y_click_events_have_key_events` / `a11y_no_static_element_interactions` above them, with no focus management, no announcements, and no keyboard route to creating or removing an arc.

## Where to start

- `app/src/lib/components/collation/StemmaPhase.svelte` — the node group (~469–537) with its suppression comments at ~472–473, and the arc delete hitbox at ~439–454 with the same suppressions. The click-node-then-click-node handler `handleNodeClick` (~137) is the seed of pick-and-place but has no focus model. `handleKeydown` (~155) currently handles only arrow keys for unit navigation and `Escape`.
- Ticket 08's layout module and `setReadingSource` — the geometry and the one mutation. **Do not add a second mutation.**
- `app/src/lib/components/collation/AlignmentGrid.svelte` — prior art in this codebase for roving focus and keyboard-driven selection over a grid. Match its conventions.
- `app/src/lib/components/collation/ReadingsPhase.svelte` — has an `aria-live` region (~414) fed by a `liveMessage` variable. That is the established pattern for announcements here; reuse it rather than inventing one.
- `app/vite.config.ts` — register any new `phosphor-svelte/lib/*` icon in `optimizeDeps.include` (`AGENTS.md`).

## Contract

**Nodes become real focusable controls.** Render them as absolutely-positioned HTML elements (`<button>` or equivalent) laid over an SVG surface that draws only arcs. Do not keep interactive `<g>` elements with suppressed lint. The suppressions must be **deleted, not relocated** — if any remain in this file at the end, the ticket is not done.

Keyboard model:

- **One tabstop for the diagram.** Arrow keys move focus between nodes within it: up toward the prior reading, down toward posterior readings, left/right between siblings. A 12-reading unit must not create 12 tabstops.
- `Enter` lifts the focused reading; arrows move to a target; `Enter` places it, writing a `derived` source decision; `Escape` cancels and restores prior focus.
- Additional single-key actions on a focused node: mark source unclear, make root, detach.
- Every state transition — lifted, target changed, placed, cancelled — is announced through the live region, naming both readings.

Pointer model:

- Dragging a node onto another writes `derived`. Dropping on empty canvas detaches to root. Dropping on itself is a no-op.
- Drop targets are indicated visually **and** the pending relationship is announced.
- An invalid drop — one that would create a cycle — is refused with an explanation, not silently ignored.

Both routes call `setReadingSource` and nothing else. One undo step per completed gesture; a cancelled gesture creates none.

## Out of scope

- **Free node positioning.** Specifically excluded. Layout stays automatic; a drag never stores coordinates.
- **New mutations, new decision kinds, or model changes.** Ticket 08 owns the model. If you need a second store operation, something is wrong.
- The lemma-as-posterior warning, the reroot repair, connectivity. Ticket 10.
- Removing the list editor. It stays as the guaranteed route and must keep working.
- Multi-select of nodes, or dragging several readings at once.
- Pan and zoom, minimap, or arc routing beyond what ticket 08's layout returns.
- Touch-specific gesture work beyond making drag not actively broken on touch.
- Animating layout transitions.
- The readings phase, Review, or export.

## Acceptance criteria

- [ ] No `svelte-ignore a11y_*` comment remains anywhere in the stemma phase component.
- [ ] Nodes are focusable controls with accessible names identifying the reading; arcs are drawn on a non-interactive surface beneath them.
- [ ] The diagram is a single tabstop; arrow keys move focus between nodes.
- [ ] `Enter` / arrows / `Enter` creates an arc with no pointer involved.
- [ ] `Escape` mid-gesture cancels, restores focus, and creates no undo entry.
- [ ] Single-key actions set unclear, make root, and detach on the focused node.
- [ ] Every gesture state change is announced in the live region, naming the readings involved.
- [ ] Dragging a node onto another creates the arc; dropping on empty canvas detaches to root.
- [ ] A drop that would create a cycle is refused with a visible explanation.
- [ ] Each completed gesture, by either route, is one undo step.
- [ ] The list editor from ticket 08 still sets every source decision.
- [ ] Any newly imported icon is registered in `optimizeDeps.include`.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm exec playwright test e2e/collation-editorial-phases.spec.ts
pnpm lint
pnpm check
```

The Playwright spec must assert: tabbing into the diagram lands one tabstop; arrow keys change the focused node; the lift-move-place sequence creates an arc; `Escape` cancels; and the live region receives text on each transition. Extend the spec created in ticket 07 rather than adding a second file.

To verify by hand: `pnpm run dev`, reach the stemma phase, unplug the mouse, and build a complete three-generation stemma. Then rebuild the same stemma by dragging. Both must produce identical data.

## Blocked by

- Ticket 08
