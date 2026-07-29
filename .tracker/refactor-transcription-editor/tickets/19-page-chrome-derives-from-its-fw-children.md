# Ticket 19: Page chrome derives from its `fw` children

## Parent

`../INVENTORY.md` F45.

## What to build

Page chrome — label, running title, catchword, quire signature — is stored twice: once as `fw` content in the page's lines, once as page attributes. The two drift.

Reclassifying an `fw` writes the newly classified attribute and never clears the old one. Deleting a selected `fw` performs no page-attribute synchronisation at all. The page then displays a label, title, catchword or signature that no longer matches its children, until reinitialization or reload. A page-list rebuild does not help — it reads the already-stale attributes.

## Where to start

`app/src/lib/components/transcriptionEditor/editorCommands.ts:106` (the sync path), `FormWorkInspector.svelte:65` (reclassification), and `transcriptionEditorSchema.ts:979` (`Page`'s chrome attributes).

`pageFormwork.ts` holds `getPageChromeAttrs` and the classification helpers.

This is the third instance in the inventory of one mistake — **a parent caching a fact about its children**:

- F22, the stale `hasFrameZones` class (ticket 14).
- § C, `lineNumber` and `columnNumber` as attributes (ticket 28).
- F45, page chrome mirrored into page attributes.

Read the other two tickets' framing before choosing an approach here; the same conclusion has already been reached twice.

## Contract

- Page chrome is **derived from the `fw` children**, not mirrored into page attributes. Reclassifying or deleting an `fw` cannot leave stale chrome, because there is nowhere for staleness to live.
- If the page attributes cannot be removed outright — check whether TEI export or the page list depends on them before assuming they can — then every write path that changes an `fw`'s classification must clear the previous attribute, and deletion must synchronise. Prefer removal; take the second path only with a recorded reason.
- The metadata dialog continues to show and set chrome exactly as it does now. This is not a UI change.
- TEI export of page chrome is unchanged, asserted by a round trip.

## Out of scope

- The `fw` content model — ticket 22. This ticket is about *where the chrome lives relative to the page*, not about how an individual `fw`'s content is stored.
- `Page.renderHTML`'s frame-zone class (F22) — ticket 14.
- The formwork classification logic in `formworkConcepts.ts`.

## Acceptance criteria

- [ ] Reclassifying an `fw` from page label to running title leaves the page showing a running title and no label.
- [ ] Deleting an `fw` that supplied the page label leaves the page with no label.
- [ ] Both of the above hold without any reinitialization, reload or explicit resync.
- [ ] The page list rebuilt after either action shows the correct chrome.
- [ ] A page with all four chrome kinds round-trips through TEI export unchanged.
- [ ] The metadata dialog shows the same values it does today for an unmodified page.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor/transcriptionEditorCommands.svelte.spec.ts
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: reclassification and deletion leave no stale chrome, asserted through the real metadata dialog; the TEI round trip is unchanged.

## Blocked by

None - can start immediately.
