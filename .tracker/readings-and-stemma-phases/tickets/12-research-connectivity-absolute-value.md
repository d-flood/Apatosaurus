# 12 — Research: is connectivity ever non-numeric?

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

Nothing. This is a research ticket producing a written answer, not code.

**Question:** does CBGM tooling accept a non-numeric **connectivity** value — an unlimited or "absolute" setting — or is connectivity always a positive integer?

**Why it matters:** connectivity is modelled as `number` in ticket 10. If an unlimited value is real, the type must be `number | 'absolute'` and the control must offer it. Discovering that after ticket 10 ships means a second change to the persisted document shape and to the exporter. Discovering it before means one extra union member.

**Why it gates nothing:** ticket 10 can ship with `number` and be widened later at real but modest cost. This ticket exists to make that cost zero if the answer arrives in time. Do not let it block anything.

## Where to start

Primary sources, in order of authority:

- **open-cbgm** (`github.com/jjmccollum/open-cbgm`) — its `examples/` directory holds valid collation files, and its source parses `<f name="connectivity">`. The parser is the authority on what values are accepted: look for how the numeric value is read and whether any non-numeric branch exists.
- **The published ECM apparatus data** for any volume — search for `connectivity` and collect the distinct values that actually occur.
- **CBGM literature** — Mink's methodological papers, Wachtel, and Gurry's *A Critical Examination of the CBGM*, which discusses connectivity as an editorial parameter and may state whether an unlimited setting is meaningful.
- The repo's own `example_collation.xml` uses `<f name="connectivity"><numeric value="10"/></f>`. Note that `<numeric>` is a strong hint toward integers only — but a different element could carry a non-numeric value, so absence of a non-numeric example in one file is weak evidence.

Two things worth answering while you are there, since they cost nothing extra:

- What range of integer values actually occurs in published data? Ticket 10 offers 1, 2, 3, 5, 10 as presets on the basis of design discussion, not evidence.
- Is connectivity ever recorded at a level other than the variation unit — per collation, per book?

## Contract

Append the findings to this ticket under an `## Answer` heading. State:

- The answer, plainly, in one sentence.
- The evidence, with links or file references specific enough to re-check.
- Whether it is positive confirmation or inference from absence. **Do not present absence as confirmation** — an inference is still useful, but it must be labelled, because a later contradiction changes what we do.
- If non-numeric values exist: their exact serialised form and how tooling interprets them.
- The distinct integer values observed, and whether ticket 10's presets match practice.

Then, if the answer changes anything, say so explicitly: either "ticket 10 needs `number | 'absolute'`" or "ticket 10's `number` is correct."

## Out of scope

- Writing any code. No type changes, no control changes, no exporter changes. If the answer is that widening is needed, the change belongs in ticket 10 — update that ticket's contract and note it here.
- Vendoring or adding dependencies.
- Researching anything else about the CBGM. The unclear-source encoding is already settled by inference from absence and recorded in the spec; re-verifying it is welcome if it is free while you are in the same sources, but it is not this ticket's job.
- Deciding whether Apatosaurus should *support* unlimited connectivity as a feature. This ticket establishes what the format and tooling do, not what we want.

## Acceptance criteria

- [ ] This ticket has an `## Answer` section stating the answer in one sentence.
- [ ] Evidence is cited specifically enough for a reviewer to re-check independently.
- [ ] The answer is explicitly labelled as positive confirmation or inference from absence.
- [ ] The distinct connectivity values observed in real data are listed.
- [ ] A clear statement of whether ticket 10's contract needs to change, and if so, ticket 10 is updated to match.
- [ ] Status set to `Completed` in `TRACKER.md`.

No commands to run — this ticket produces prose. Success is a reviewer being able to follow the citations and reach the same conclusion.

## Blocked by

None - can start immediately.

## Answer

**Conclusion (positive confirmation):** open-cbgm has an unlimited "absolute" connectivity mode, whose documented per-variation-unit representation omits the connectivity feature, so ticket 10 needs `number | 'absolute'` and ticket 11's exporter must encode an explicit `'absolute'` decision by omitting that feature.

- **Tooling, positively confirmed.** At open-cbgm v2.1 commit [`42efa17072ece7c968ee1a30ebb13303463f79cf`](https://github.com/jjmccollum/open-cbgm/blob/42efa17072ece7c968ee1a30ebb13303463f79cf/src/variation_unit.cpp#L189-L198), `variation_unit.cpp` lines 189-198 initialize connectivity to `numeric_limits<int>::max()` for absolute connectivity, then select only `note/fs/f[@name="connectivity"]/numeric` and assign only a positive `numeric/@value`. The companion fixture makes omission explicit: [`examples/test.xml` lines 45-64](https://github.com/jjmccollum/open-cbgm/blob/42efa17072ece7c968ee1a30ebb13303463f79cf/examples/test.xml#L45-L64) calls a unit with no connectivity feature "implicit \"absolute\" connectivity," and [`test/autotest.cpp` lines 586-610](https://github.com/jjmccollum/open-cbgm/blob/42efa17072ece7c968ee1a30ebb13303463f79cf/test/autotest.cpp#L586-L610) asserts that it becomes `numeric_limits<int>::max()`. No specific non-numeric token is documented or observed; an unrecognised child would simply leave the same default, so its acceptance is not positively established.
- **Scope, positively confirmed.** The parser constructs a `variation_unit` from an `<app>` ([`variation_unit.cpp` lines 35-41](https://github.com/jjmccollum/open-cbgm/blob/42efa17072ece7c968ee1a30ebb13303463f79cf/src/variation_unit.cpp#L35-L41)) and performs the relative `note/fs/...` lookup within it (lines 189-200 above). The v2.1 README also calls `<fs>` "a variation unit's connectivity" ([lines 34-36](https://github.com/jjmccollum/open-cbgm/blob/42efa17072ece7c968ee1a30ebb13303463f79cf/README.md#L34-L36)). It is per variation unit, not per collation or book.
- **Observed values.** The included published ECM 3 John collation identifies itself as *Editio Critica Maior*, Deutsche Bibelgesellschaft, Stuttgart, 2014 ([`3_john_collation.xml` lines 3-12](https://github.com/jjmccollum/open-cbgm/blob/42efa17072ece7c968ee1a30ebb13303463f79cf/examples/3_john_collation.xml#L3-L12)); its 116 variation units are also identified in the README ([line 34](https://github.com/jjmccollum/open-cbgm/blob/42efa17072ece7c968ee1a30ebb13303463f79cf/README.md#L34)). All 116 of its connectivity features are `<numeric value="10"/>` (representative unit: [lines 161-177](https://github.com/jjmccollum/open-cbgm/blob/42efa17072ece7c968ee1a30ebb13303463f79cf/examples/3_john_collation.xml#L161-L177)); the repository's completed-stemma variant likewise has 116 `10` values. Recheck at that commit with `rg -o '<numeric value="[^"]+"' examples/3_john_collation.xml examples/3_john_collation_complete.xml | sort -u` and `rg -c '<f name="connectivity">'` on those files: respectively `10`, and 116 in each file. The separate artificial test fixture uses `5` ([`test.xml` lines 28-43](https://github.com/jjmccollum/open-cbgm/blob/42efa17072ece7c968ee1a30ebb13303463f79cf/examples/test.xml#L28-L43)), so values observed across all bundled examples are `5` and `10`, but the published ECM data inspected supports only `10`. Ticket 10's preset `10` matches evidenced practice; `1`, `2`, `3`, and `5` have no support from this corpus.
- **Inference from absence, not confirmation.** This one published corpus and the bundled examples contain no explicit non-numeric token and no other published finite value; that inventory does not establish that another ECM volume never uses one. The conclusion about the absence-based absolute serialization does not depend on that inventory: it is positively confirmed by the parser and its fixture/test above.
- **Ticket 10.** Its `number`-only, unset-means-`10` contract cannot represent open-cbgm's meaningful omitted-feature absolute mode while retaining sparse decisions. It needs `number | 'absolute'`; ticket 11's exporter must serialize an explicit `'absolute'` decision as no `connectivity` `<f>`, not as an XML string. Ticket 10's contract has been updated accordingly.
