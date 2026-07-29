# Ticket 21: Inspector Apply merges instead of replacing

## Parent

`../SPEC.md` § D; `../INVENTORY.md` F40, F41.

## What to build

Two inspector surfaces rebuild a value from the fields their form happens to expose, and throw away everything else. Editing one visible field therefore deletes TEI metadata the plain round trip preserves.

- **F40** the correction workspace rebuilds a reading from four fields.
- **F41** the simple-carrier inspector replaces `teiAttrs` wholesale.

F40 also has a second, independent defect: two of its controls have no effect on the TEI at all.

## Where to start

**F40** — `CorrectionWorkspace.svelte:90`; the model at `tei-parser.ts:1118`; the serializer at `tei-serializer.ts:768`.

The TEI model preserves `rend`, arbitrary `readingAttrs` and arbitrary `segmentAttrs`. The workspace loads only `hand`, `type`, `position` and content, then writes back a newly constructed reading containing only those. Executed: a reading with `rdg/@type="alt"`, `rend`, `source`, `resp` and a wrapping `<seg type="margin" subtype="pagetop" n="@P1" xml:id="seg1">` exported after Apply as:

```xml
<rdg type="corr" hand="c2"><w>beta</w></rdg>
```

Reachable from both correction marks and `correctionNode`.

**The second defect:** the workspace writes its Type and Position controls to top-level `type` and `position`, but `exportCorrectionReading` serializes only `readingAttrs` and `segmentAttrs`. Those two controls have **no TEI effect whatsoever**, even on a new reading with no metadata to preserve. That is a broken control rather than a preservation bug, and it is the cheaper half — fix it first and independently.

**F41** — `SimpleCarrierInspector.svelte:74`. The break, `space`, `handShift` and `teiMilestone` branches replace `teiAttrs` with only their form's fields. These nodes otherwise admit and round-trip arbitrary TEI attributes, so editing one visible field deletes `facs`, `resp`, `rendition` and anything else the source carried. The existing inspector spec only touches displayed fields, which is why it cannot see the loss — the same fixture weakness ticket 06 addressed elsewhere.

## Contract

- **Apply merges; it never replaces.** An inspector writes the fields its form owns and leaves every other key of `teiAttrs` (and of the reading) exactly as it found it.
- An attribute the form does not display survives an edit to one that it does. This is the single assertion that matters and every acceptance criterion is a variation of it.
- The correction workspace's Type and Position controls produce TEI. Route them to `readingAttrs` / `segmentAttrs` as appropriate — check what the serializer actually reads before choosing.
- A `<seg>` carrier on a reading survives a content-only edit.
- No inspector introduces a key that was not there and was not set by the user.

**Note on the deeper cause.** F40, F41 and F42 are one problem wearing three hats: an editing surface that must parse a serialised blob, build a form from part of it, and write a whole new blob back will lose whatever its form does not model. Ticket 22 removes that requirement for `fw` by moving content into the document. This ticket fixes the two surfaces that ticket 22 does **not** cover, and its merge logic should not be built in a way that ticket 22 would have to unpick.

## Out of scope

- `FormWorkInspector` — ticket 22.
- The `JSON.stringify` draft-syncing pattern shared by six components (F32). Deferred until after ticket 22 lands.
- The correction draft-index bug (F43) — ticket 23.
- Changing what any form displays. Add no fields.

## Acceptance criteria

- [ ] A reading with `rend`, `source`, `resp` and a `<seg>` carrier survives a content-only edit through the correction workspace, exported XML asserted.
- [ ] The same for a `correctionNode`-hosted reading.
- [ ] Setting Type and Position on a new reading produces corresponding TEI.
- [ ] A `space` node with `facs` and `xml:id` survives an edit to its displayed field.
- [ ] The same for a break node, `handShift` and `teiMilestone`.
- [ ] Each of the above uses a fixture carrying at least one attribute the form does not display.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor/inlineCarrierWorkspace.svelte.spec.ts
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm run check
pnpm run test:unit -- --run
```

Success: every fixture carries an unexposed attribute, and every Apply preserves it.

## Blocked by

None - can start immediately.
