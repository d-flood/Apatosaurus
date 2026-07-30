# 08 — Local stemma: source decisions, tree projection, layout, and the list editor

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

Make the **local stemma** constructible and correct, with the **accessible route first**. A scholar sets each reading's **source decision** from a labelled control in a list beside the diagram; the diagram renders the resulting tree, laid out automatically, at any depth. Dragging and keyboard lift-and-place arrive in ticket 09 as accelerators — so if that ticket slips, the phase is still fully operable, which is the entire reason for this ordering.

Four failures are fixed:

1. **The diagram asserts two contradictory things.** `layoutNodes` positions nodes by subreading attachment — a citation concern — then draws arcs over that layout representing genealogy. Position claims one hierarchy, arrows claim another.
2. **The layout cannot represent real stemmata.** It is a fixed two-row arrangement in a hardcoded `600×200` viewBox. Three generations render on top of each other or off-canvas.
3. **There is no way to say "undetermined."** The model is an unconstrained arc set, so a reading either has an arc or does not, and an unconsidered reading is indistinguishable from a considered one whose origin cannot be established.
4. **The suggestion roots on the majority reading** — the one genealogical heuristic textual critics most actively reject.

## Where to start

- `app/src/lib/components/collation/StemmaPhase.svelte` — `layoutNodes` (~62–123) is the layout to replace, `getNodePos` (~127), the SVG block (~401–538), and `suggestStemma`'s trigger (~382). The left panel's reading list becomes the source-decision list.
- `app/src/lib/client/collation/collation-state.svelte.ts` — `addStemmaEdge` (~2656), `removeStemmaEdge` (~2665), `suggestStemma` (~2677, note it sorts by witness count descending and roots on the largest), and `stemmaEdges` / `stemmaNodes` (~197). `stemmaNodes` is written nowhere meaningful — check before preserving it.
- `app/src/lib/client/collation/collation-types.ts` — `StemmaEdge` carries a `directed` boolean. Direction belongs to the graph in the target format, not the arc; drop it.
- `app/src/lib/client/collation/collation-document.ts` — `CollationStemmaNode` / `CollationStemmaUnitNode` (~88–98) are the persisted shape.
- `app/src/lib/client/collation/alignment-diff.spec.ts` — prior art for a pure-function spec with no DOM.
- `example_collation.xml` and open-cbgm's `examples/3_john_collation_complete.xml` — `<graph type="directed">` with a `<node n="a"/>` per reading and `<arc from="a" to="b"/>`. Note **subreadings are not nodes**; nodes join to readings by label.

## Contract

```ts
type SourceDecision =
  | { kind: 'undecided' }                       // default; not a claim
  | { kind: 'unclear' }                         // considered; undeterminable
  | { kind: 'derived'; from: string };          // prior reading id

// decisions overlay gains:
sourceDecision?: Record<string, SourceDecision>;
```

**Storage stays arc-based.** Keep `StemmaEdge[]` (minus `directed`) as the persisted form so multiple sources remain expressible later without a schema change. A projection sits between:

```ts
projectLocalStemma(readings: ClassifiedReading[], arcs: ReadingArc[], lemmaReadingId: string | null): {
  nodes: StemmaTreeNode[];              // one per main reading; subreadings folded in
  violations: StemmaViolation[];        // readings with more than one incoming arc
};

setReadingSource(unitIndex: number, readingId: string, decision: SourceDecision): void;
```

Rules:

- `setReadingSource` is the **only** mutation the stemma UI performs. It replaces all incoming arcs for that reading with at most one. Tickets 09 and 10 add input routes and adjacent data, not new mutations.
- **`undecided` and `unclear` are different and must look different.** Undecided reads as *unanswered*, not merely unconnected. Only `unclear` is a claim.
- **Subreadings are folded into their main reading's node** and never appear as separate nodes — this is what removes the contradictory-diagram problem.
- **Non-attestation never appears as a node** (guaranteed by ticket 03's data).
- **The lemma reading is the default root.** Replace the majority-witness heuristic entirely. A newly-built stemma roots on the lemma with every other reading `undecided`. If a suggestion feature is kept at all, it must not assert genealogy from witness counts.
- More than one incoming arc is a **reported violation**, not a rendering guess and not a rejected write. The interface enforces one source; the projection surfaces anything else.
- Cycles are rejected at write time with an observable refusal.

Layout is a separate pure module:

```ts
layoutLocalStemma(nodes: StemmaTreeNode[]): {
  nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  arcs: Array<{ id: string; from: string; to: string; path: string }>;
  bounds: { width: number; height: number };
};
```

- Layered top-down, roots at top. No DOM, no store, deterministic for equal input.
- **The viewport fits computed `bounds`.** No hardcoded dimensions anywhere.
- Nodes for `undecided` and `unclear` readings still receive positions — they are visible, just unconnected.

## Out of scope

- **Dragging, keyboard lift-and-place, and live-region announcements.** Ticket 09. This ticket's diagram may be read-only; all editing goes through the list.
- **The lemma-as-posterior contradiction warning, the reroot repair, and connectivity.** Ticket 10.
- Multiple sources as an editing affordance. Storage permits them; the UI does not offer them.
- Arc labels or relational typology.
- Export of `<graph>`, `<node>`, `<arc>`. Ticket 11.
- Global stemma, coherence, textual flow. Not in this epic.
- Free node positioning. **Specifically excluded** — it is what makes accessible graph editing impossible.
- Rebuilding the reading list panel into cards. That is the readings phase (ticket 07); the stemma phase's list is a source-decision list, deliberately plainer.
- Preserving `stemmaNodes` if nothing writes it. Remove it rather than carrying dead state forward.

## Acceptance criteria

- [ ] A reading's source decision is settable to derived, unclear, or undecided from a labelled control in a list, without a pointer.
- [ ] `undecided` and `unclear` are visually and programmatically distinguishable, in both the list and the diagram.
- [ ] A pure projection module folds subreadings into their main reading's node and emits one node per main reading.
- [ ] A reading with two incoming arcs appears in `violations` and is not silently mis-rendered.
- [ ] Setting a source that would create a cycle is refused, observably.
- [ ] A pure layout module returns positions, arc paths, and computed bounds, with no DOM or store imports, and is deterministic for equal input.
- [ ] A spec asserts a stemma four generations deep produces non-overlapping node positions.
- [ ] The rendered diagram fits its computed bounds; no hardcoded viewBox dimensions remain.
- [ ] A newly-built stemma roots on the lemma reading with all others undecided; no code roots on witness count.
- [ ] Non-attestation and subreadings never appear as nodes.
- [ ] Source decisions persist and survive an unrelated edit to the same unit; each is one undo step.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm lint
pnpm check
```

To verify by hand: `pnpm run dev`, reach the stemma phase, and build a three-generation stemma entirely from the list controls using only the keyboard. The diagram must lay out legibly and no reading may be ambiguous between "not yet considered" and "cannot be determined."

## Blocked by

- Ticket 03
- Ticket 05
