# 11 — Review phase and reconstructive TEI apparatus export

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

End the flow in the thing a scholar was making. A fifth **Review** phase presenting the finished apparatus for the verse, the local stemmata together, the divergence report, a worklist of unresolved decisions linking back to the units responsible, and export to TEI validated against a published schema. Committing a version moves here as the natural close of the work.

Today the flow ends at the stemma phase and the only terminal action is a version commit in the workspace header — a file operation, not a scholarly one. Arcs and reading data are persisted and read by nothing; there is no apparatus view anywhere in the app; the TEI exporter handles transcriptions only.

The export is **reconstructive**: agreed text is emitted alongside the variation, so every witness's text can be rebuilt from the apparatus rather than only its points of variance. This is the property that makes this app's output better than the reference corpus, which omits it.

## Where to start

- Ticket 06's segment module — `buildSegmentSequence` supplies the agreed segments and unit sequence. **The exporter consumes it; it must not derive its own.** Divergence between them is what would silently break reconstructability.
- Ticket 05's divergence data, ticket 08's `violations`, ticket 10's contradiction reports, ticket 03's untranscribed witness collection, and ticket 04's untyped-subreading condition — the worklist is an aggregation of what earlier tickets already expose. Do not recompute any of it.
- `app/src/lib/components/collation/CollationStepper.svelte` — `steps` and `phaseOrder` (~8–15). Note `displayPhase` folds `regularization` into `alignment`; **Review is not that pattern** — it is a real step.
- `app/src/lib/components/collation/CollationWorkspace.svelte` — phase dispatch (~367–377) and the commit form (~320–362), which moves into Review.
- `app/src/lib/client/collation/collation-document.ts` — `normalizePhase` (~186) maps any unrecognized phase to `'setup'`. **Change it to clamp to the last known phase**: resetting also resets `furthestPhase`, which drives `canNavigateTo`, so a completed collation would present as untouched with every step locked.
- `app/src/lib/tei/test-real-export.spec.ts` and `test-support/validate-igntp-xsd.ts` — the prior art for schema-validated export testing.
- `scripts/validate_tei_xsd.py` — takes `--schema` and `--xml`, uses `etree.XMLSchema` (XSD only), and parses with `no_network=True`.
- `example_collation.xml` (repo root) and open-cbgm's `examples/3_john_collation_complete.xml` — the target structure.

## Contract

### Review phase

- A real fifth step in the stepper, added to `CollationPhase` and `phaseOrder`.
- **Reachable once an alignment exists**, not gated on completing the local stemmata — checking the apparatus is part of building it. `furthestPhase` still advances to it so the stepper reads as complete.
- Contents: verse apparatus (rendered via ticket 06), local stemmata as small multiples (via ticket 08's layout), divergence report, unresolved-decision worklist with links that navigate to the offending unit, export, version commit.

### Serialisation

Structure follows the reference corpus: `<app from n to>` per unit inside the verse body, `<lem>`, `<rdg n varSeq wit>`, and `<note>` carrying `<label>`, `<fs><f name="connectivity">`, and `<graph type="directed">` with `<node>` and `<arc from to>`.

Contracts settled during design — carry them exactly:

- **Agreed text is emitted** so every witness's text is reconstructible. Unconditional. The dormant `segmentation` setting in `ProjectCollationSettings` is **unrelated** — do not wire it up, do not make emission conditional on it, do not delete it.
- **Subreadings are flat**, with the relationship carried by the label convention (`a`, `a1`). **Do not use `<rdgGrp>`** — flat is current IGNTP practice, and graph nodes join to readings by label. Subreadings get **no `<node>`**.
- **Omission** is an empty `<rdg>` carrying `type="om"` — a superset of both conventions found in the wild.
- **Non-attestation** is one reading per unit under the reserved label `zz` with `type="lac"`, ordered last, and **never a `<node>`**.
- **`undecided` source decisions do not serialise.** `unclear` serialises as the **absence** of an incoming arc — there is no unknown-source node in the reference corpus. `<node>` is emitted for **every** reading regardless of source decision.
- **`<lem>`** carries the witnesses that actually attest it. `basetext` appears in `@wit` only when the base text genuinely attests the lemma — never mechanically.
- Reading type serialises as `@type`; certainty as `@cert`.

### Export gating

Export **refuses** rather than guessing:

- Units with `undecided` source decisions.
- Units with untranscribed witnesses — never emitted as `lac`, because that asserts damage that may not exist.
- Units needing a lemma decision (ticket 05) where none was made.

Refusals name the units and link to them. A scholar can always *view* the apparatus; only export is gated.

### Schema validation

- Validate against **TEI P5 all-modules**, not the vendored NT manuscripts schema. That schema is an upstream submodule (**do not modify it**) and a transcription schema: its ODD omits the `nets` and feature-structure modules, so `<graph>`, `<arc>`, and `<fs>` cannot validate against it. The reference corpus contains `<graph>`, so TEI P5 is the only schema it can be valid against.
- Leave `validateIgntpXsd` and its use for transcriptions **untouched**.
- Add a sibling validator. Recommended: vendor `tei_all.rng` and extend `validate_tei_xsd.py` additively with a schema-kind flag selecting `etree.RelaxNG` or `etree.XMLSchema`. RelaxNG is a single file; the TEI XSD is a multi-file set with imports, and the script parses with `no_network=True`, so vendoring the XSD means vendoring its imports correctly too.

### Exporter placement

A **new module**, not an extension of the transcription exporter — different input, different output, different consumer. Reuse only low-level escaping and serialisation helpers.

## Out of scope

- **Apparatus import.** No reading of foreign apparatus files, despite round-tripping being the established pattern for transcriptions. Reconciling a foreign apparatus against a local alignment is larger than this entire epic.
- Coherence, textual flow, global stemma, substemma optimisation.
- Modifying the `NT_Manuscripts_TEI_Schema` submodule.
- Making agreed-text emission optional, or a compact seg-less export mode.
- `<rdgGrp>`.
- Arc labels or relational typology.
- Export formats other than TEI. No JSON, CSV, or PDF apparatus.
- Reworking the version-commit mechanism itself — it moves location; its behaviour is unchanged.
- Multi-verse or whole-book export.
- Changing `validateIgntpXsd` or the transcription export path.

## Acceptance criteria

- [ ] Review is a fifth step in the stepper, present in `CollationPhase` and `phaseOrder`, and is not folded by `displayPhase`.
- [ ] Review is reachable when an alignment exists and incomplete stemmata do not block navigation to it.
- [ ] `normalizePhase` clamps an unrecognized phase to the last known phase; a spec asserts `furthestPhase` is not reset.
- [ ] Review shows the verse apparatus, local stemmata together, the divergence report, and a worklist whose entries navigate to the responsible unit.
- [ ] The version commit is invocable from Review.
- [ ] The exporter is a new module and consumes ticket 06's segment sequence rather than deriving its own — a spec asserts both surfaces agree for the same collation.
- [ ] Exported apparatus validates against TEI P5 all-modules through a new sibling validator.
- [ ] `validateIgntpXsd` and the transcription export spec are unchanged — `git diff` shows no edits to either.
- [ ] A spec walks an exported apparatus and reconstructs each witness's text, asserting it matches the witness's aligned tokens.
- [ ] Subreadings export flat with label-carried relationships, no `<rdgGrp>`, and no `<node>` of their own.
- [ ] Omission exports as an empty `<rdg type="om">`; non-attestation as one `zz`/`lac` reading ordered last and never a node.
- [ ] `unclear` exports as absence of an incoming arc; `<node>` is present for every reading.
- [ ] `<lem>` includes `basetext` in `@wit` only when the base text attests the lemma.
- [ ] Export refuses a collation with an undecided source decision, an untranscribed witness, or a missing required lemma decision, naming the units.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm exec playwright test e2e/collation-editorial-phases.spec.ts
pnpm lint
pnpm check
```

Extend the Playwright spec from tickets 07 and 09 to walk setup through Review and export; do not add a second spec file.

To verify by hand: `pnpm run dev`, complete a small collation, reach Review, confirm the apparatus matches what the readings phase showed, export, and validate the file. Then leave one reading's source undecided and confirm export refuses and names that unit.

## Blocked by

- Ticket 06
- Ticket 10
