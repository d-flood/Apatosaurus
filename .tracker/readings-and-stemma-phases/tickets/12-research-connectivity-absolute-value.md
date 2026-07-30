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
