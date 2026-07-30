# 06 — Segment and apparatus renderer, with live preview

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

One pure module that derives, from an alignment, the sequence of **agreed-text segments** and **variation units** across a verse, and renders a variation unit into conventional apparatus notation. Then put that notation on screen, live, at the top of the readings pane so a scholar can check their decisions in the notation they actually think in.

The shared-ness is the point. **Three surfaces consume this module**: the basetext strip, the live apparatus preview, and the export in ticket 11. If they each derive their own segmentation, they drift, and reconstructability breaks silently — an exported apparatus from which witnesses cannot be rebuilt, with nothing on screen indicating anything is wrong.

The segmentation this needs already exists in a component. `ReadingsPhase.buildBasetextSegments` walks alignment columns and emits alternating plain segments (columns outside any variation-unit span, i.e. where all witnesses agree) and unit segments. That logic moves into the shared module and the component consumes it instead.

## Where to start

- `app/src/lib/components/collation/ReadingsPhase.svelte` (~lines 156–196) — `buildBasetextSegments`, the logic to extract. Note it uses the base witness's text as the representative for agreed stretches, and `formatSlotLabel` / `getSpanLabel` (~145–154) for the word-index labels.
- `app/src/lib/client/collation/collation-variation-units.ts` — `buildVariationUnitSpans`, which defines where variation occurs; columns outside a span are the agreed text.
- `app/src/lib/client/collation/collation-state.svelte.ts` — `getDisplayedColumnSlots`, `getVariationUnitSpans`, `getBaseTextForVariationUnit`.
- `app/src/lib/tei/tei-exporter.spec.ts` — prior art for a rendering spec.
- `example_collation.xml` at the repo root — `<app from="1" n="B04K6V23" to="1">` shows the word-index anchoring the notation must reproduce, and `<rdg n="a" varSeq="1" wit="…">` the label/order/attestation shape.

For the notation itself, the target reads roughly:

```
12–14 ⸂ εν χριστω ιησου ] a: 01 03 P46 | b: 02 05 | b1: 044 | zz: 869
```

Unit range, the lemma text, then each reading by label with its attesting sigla. Non-attestation last.

## Contract

```ts
buildSegmentSequence(input: {
  columns: AlignmentColumn[];
  spans: VariationUnitSpan[];
  baseWitnessId: string | null;
}): Segment[];

type Segment =
  | { kind: 'agreed'; text: string; label: string; columnIds: string[] }
  | { kind: 'unit'; span: VariationUnitSpan; ordinal: number; label: string };

renderApparatusUnit(unit: UnitView, options): string;
```

Rules:

- **Agreed segments are where every attesting witness reads the same thing.** They are what makes an apparatus reconstructive. Deriving them from the base witness's text is acceptable *because* all attesting witnesses agree there — but non-attesting witnesses must not be counted as disagreeing, or agreed stretches will fragment wherever any witness is lacunose. This is the subtle case; test it.
- The module is pure: no store import, no Svelte runes, no DOM.
- Rendering uses the vocabulary settled for this epic: lemma reading first as `a`, subreadings by their derived labels, non-attestation last under its reserved label, reading types shown where present.
- The preview updates as decisions change and must be reachable by assistive technology — it is information, not decoration, so it is real text, not an image or a canvas.
- `renderApparatusUnit` produces the *display* notation. Ticket 11's exporter produces TEI from the same `Segment[]` and the same unit view — the shared input is the invariant, not a shared string format.

## Out of scope

- **TEI serialisation.** No `<app>`, `<rdg>`, `<seg>`, `<graph>`. Ticket 11. This module produces the segment sequence that ticket 11 will consume, and human-readable notation for the screen.
- Schema validation. Ticket 11.
- The readings phase reframe. Keep the existing table; add the preview line above it and repoint the basetext strip at the shared module. Ticket 07.
- The Review phase. Ticket 11.
- Changing how spans are computed or how alignment works.
- Rendering local stemmata. Tickets 08 and 09.
- Adding an export button anywhere.

## Acceptance criteria

- [ ] A pure module exports `buildSegmentSequence` and `renderApparatusUnit`, importing no store, no runes, and no DOM.
- [ ] `ReadingsPhase` no longer contains its own `buildBasetextSegments`; the basetext strip renders from the shared module.
- [ ] A spec asserts the segment sequence alternates agreed and unit segments and covers every column exactly once — exhaustive and non-overlapping.
- [ ] A spec asserts an agreed stretch does **not** fragment when a witness is non-attesting across it.
- [ ] A spec asserts rendered notation includes the unit range, the lemma text, and every reading label with its attesting sigla, with non-attestation last.
- [ ] The readings pane shows live apparatus notation for the selected unit, updating when a decision changes.
- [ ] The preview is selectable text reachable by a screen reader.
- [ ] The basetext strip renders identically to before this ticket for a collation with no non-attestation — a visual regression check by eye is acceptable, stated in the PR.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm lint
pnpm check
```

To verify by hand: `pnpm run dev`, open a collation, select a unit, and confirm the notation line matches the readings shown below it. Change a reading's witnesses and watch the line update.

## Blocked by

- Ticket 03
- Ticket 04
- Ticket 05
