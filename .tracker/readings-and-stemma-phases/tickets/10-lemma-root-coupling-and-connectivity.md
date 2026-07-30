# 10 — Lemma/root coupling and connectivity

## Parent

`.tracker/readings-and-stemma-phases/SPEC.md`

## What to build

Two things that complete the CBGM data entry model for a variation unit.

**Lemma/root coupling.** In this method the initial text's reading roots the local stemma: every other reading derives from it, directly or transitively. Since ticket 05 made the **lemma reading** editorially elevatable, the two phases are now coupled — a scholar can elevate reading `c` to lemma while arcs still say `a → c`, leaving the stemma asserting that the lemma arose from something else. That contradiction must become **visible** without becoming **enforced**.

The distinction matters and is the whole design of this ticket: scholars pass through inconsistent intermediate states while thinking. The app's job is to notice, not to forbid. Hard-enforcing the lemma as root — rejecting any arc that makes it posterior — would make the editor fight the scholar mid-thought, which is the failure mode this epic exists to remove. Equally, silently rewriting arcs when the lemma changes would destroy genealogical work as a side effect of a labelling decision.

**Connectivity.** A per-variation-unit integer recording how many generations of intermediary witnesses may separate two attestations of a reading before their agreement stops counting as evidence of relationship. Editors lower it for readings likely to have arisen independently. It belongs on this screen because in this method it is the same judgement about the same variant, made at the same moment as the local stemma. It is already in the target format and read by the reference implementation, and an export carrying a default the scholar never saw asserts an editorial position on their behalf.

## Where to start

- Ticket 08's projection (`projectLocalStemma`) and `setReadingSource`, and its `violations` channel — the contradiction reported here is a sibling of the multiple-source violation already surfaced there. Extend that mechanism rather than adding a parallel one.
- Ticket 05's lemma decision and the divergence data it exposes.
- `app/src/lib/components/collation/StemmaPhase.svelte` — the header area (~371–389) is where a per-unit control and warnings belong.
- `app/src/lib/client/collation/collation-document.ts` — `CollationStemmaUnitNode` (~88) is the persisted per-unit stemma shape; connectivity is per-unit data and belongs alongside it.
- `example_collation.xml` at the repo root — every `<app>` carries `<note><fs><f name="connectivity"><numeric value="10"/></f></fs>…</note>`. Note connectivity and the `<graph>` sit in the same `<note>`, which confirms they are one editorial moment.

## Contract

```ts
// decisions overlay gains:
connectivity?: number;                 // per variation unit; default 10
```

Connectivity rules:

- Default **10**. Persisted only once a scholar sets it, following the decisions-are-sparse pattern; the default is applied on read.
- The control offers the values editors actually use — 1, 2, 3, 5, 10 — plus free entry. **Not a bare number input**: the common values carry meaning, and a free field invites a typo into an exported editorial claim.
- One undo step per change.
- Reject non-positive and non-integer values at the boundary with an observable refusal.
- Ticket 12 is researching whether a non-numeric unlimited value exists. **Model `number` only for now.** If ticket 12 resolves affirmatively before this ticket is picked up, widen to `number | 'absolute'` here rather than later.

Lemma/root rules:

- **The lemma reading is the default root** — already true from ticket 08. This ticket adds what happens when arcs disagree.
- If any arc makes the lemma a posterior reading, report it as a violation on the unit. It appears on the stemma phase and is collected for the Review worklist.
- **Do not reject the arc, and do not auto-rewrite arcs** when the lemma changes. Both are explicitly wrong.
- Offer a **"reroot on lemma"** repair alongside the warning: one action, one undo step, that removes the arcs making the lemma posterior. It is offered, never automatic.
- Editing remains fully possible while a contradiction exists.

## Out of scope

- Consuming connectivity for anything. Coherence computation is not in this epic — connectivity is entered and stored, not used.
- Exporting connectivity or the graph. Ticket 11.
- Hard-enforcing the lemma as root, or validating that a stemma is fully connected before allowing edits.
- Rewriting arcs automatically on any lemma change.
- Changing how the lemma is established. Ticket 05.
- New input routes for arcs. Tickets 08 and 09.
- Project-level or collation-level default connectivity settings. Per-unit only.
- A settings screen for connectivity conventions.

## Acceptance criteria

- [ ] Connectivity is settable per variation unit, defaults to 10 when unset, and persists once set.
- [ ] The control offers 1, 2, 3, 5, and 10 directly as well as free entry.
- [ ] A non-positive or non-integer connectivity is refused observably.
- [ ] A connectivity change is one undo step and survives an unrelated edit to the same unit.
- [ ] Arcs that make the lemma a posterior reading produce a reported violation on the unit.
- [ ] That arc is **not** rejected — a spec asserts the write succeeds and the violation is reported.
- [ ] Elevating the lemma leaves existing arcs byte-identical — a spec asserts arcs are unchanged before and after.
- [ ] The contradiction is visible on the stemma phase and queryable for the Review worklist.
- [ ] "Reroot on lemma" removes exactly the arcs making the lemma posterior, in one undo step, and is never invoked automatically.
- [ ] Editing source decisions still works while a contradiction exists.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm lint
pnpm check
```

To verify by hand: `pnpm run dev`, build a stemma rooted on `a`, then elevate a different reading to lemma from the readings phase and return. The contradiction is reported, the arcs are untouched, editing still works, and the reroot repair fixes it in one action that undoes in one step.

## Blocked by

- Ticket 08
