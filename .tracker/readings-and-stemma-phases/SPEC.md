# The CBGM Data Entry Phases: Readings and Local Stemmata

## Problem Statement

A scholar using Apatosaurus can gather witnesses, regularize them, and produce an alignment. Then the work stops being possible. The last two phases — Readings and Stemma — are where a machine alignment becomes an edition, and neither can be completed, trusted, or exported.

**Editorial decisions do not survive.** Subreading structure is recomputed from normalized-text equality on every write to the readings collection. Attachment is therefore not something a scholar owns; it is a value re-derived from string identity, and any judgement that disagrees with the reading proposal is erased on the next edit. One field carries both the proposal and the decision, with no way to distinguish them.

**A control on the Stemma phase silently does nothing.** Its attachment menu offers every main reading as a target, but the underlying operation refuses any target whose normalized text differs from the reading being attached. The only attachments that succeed are the ones the aligner already made. Every case a scholar would reach for — subordinating a variant to a main reading whose text differs, which is the entire point of the feature — fails silently and the menu reverts.

**The local stemma diagram asserts two contradictory things at once.** Node positions are computed from subreading attachment, which is a citation concern, while the arrows drawn over them represent genealogy, which is an editorial hypothesis. Vertical position claims one hierarchy and the arrows claim another. The layout is additionally a fixed two-row arrangement in a fixed-size canvas, so a local stemma more than one generation deep renders on top of itself or outside the viewport — and real local stemmata routinely run three or four generations.

**The local stemma is an unconstrained edge set, so the only interaction it affords is the wrong one.** The model permits cycles, multiple sources, and disconnected fragments, so editing degenerates to "click a node, click another node, an arc appears." A scholar cannot record the answer they most often have — that a reading's origin cannot be determined — so the screen demands a certainty the evidence frequently does not support. The one automated suggestion available roots the stemma on the reading with the most witnesses, which is the single genealogical heuristic textual critics most actively reject.

**The diagram cannot be operated without a mouse.** Nodes are non-interactive graphics carrying click handlers, with accessibility lint suppressed above them. There is no focus management, no announcement of connection state, and no keyboard route to creating or removing an arc.

**The readings table presents eight competing controls per row and no primary one.** Within that: a control that acts on a whole group of readings is rendered identically on every row of that group, so it reads as per-row and does something else; witness reassignment is one witness at a time through a menu, when the actual task is almost always bulk; the type control reports one thing and writes another, and conflates a fact about the text with an editorial judgement; selecting the omission type silently destroys the reading's text; reordering across groups fails with no feedback; and reordering is offered as one-position-at-a-time stepping when the operation a scholar wants is to establish which reading is the lemma.

**A lacuna is treated as a reading.** Lacunose witnesses are grouped into a bucket, given an ordinary letter, kept as a main reading, counted in witness-count ordering, and would appear as a node in the local stemma. Deficient text — where something survives but not enough to identify a reading — is indistinguishable from no testimony at all. And untranscribed material, which is a fact about project progress rather than about the manuscript, is folded in with genuine damage.

**Nothing in either phase is reversible.** Undo exists and is wired only into the earlier phases. Every readings and stemma mutation is permanent, including the one that destroys reading text. Exploration is the entire activity of these phases, and exploration without undo is not exploration.

**Nothing consumes the result.** Arcs and reading classifications are persisted and read by nothing. There is no apparatus view anywhere in the application, and the TEI exporter handles transcriptions only. The flow's terminal action is committing a version, which is a file operation. A scholar constructs readings and local stemmata for an entire verse and receives a JSON field in return — so there is no way to check their own work, and no reason to have done it.

## Solution

Recreate the CBGM's data entry phase properly: separate what the aligner proposes from what the scholar establishes, give the two editorial relations distinct screens and distinct shapes, and end the flow in an apparatus a scholar wanted.

**Editorial decisions become the authority, and the reading proposal becomes recomputable.** The reading proposal — which readings exist, which look like subreadings, provisional order, likely reading types — is a pure function of the alignment and the collation settings, derived on read and never stored as truth. Editorial decisions are a sparse record of what a scholar explicitly established. What the phases display is the proposal with decisions applied. Nothing re-derives on write, so no decision can be eaten. Re-running an alignment stops destroying editorial work, and a decision naming a reading that no longer exists becomes an orphaned decision surfaced for resolution rather than silently dropped.

**Non-attestation stops being a reading.** Witnesses whose text is damaged, lost, or illegible do not testify: they take no letter, hold no subreadings, never enter witness-count ordering, and never appear in a local stemma. They remain visible, because a scholar must see who is absent. Deficient readings — something survives, not enough to identify — remain readings, carrying a reading type that later analysis can filter on, which is what distinguishes them from non-attestation. Untranscribed witnesses are held separate from genuine damage and reported as incomplete work, never exported as though the manuscript were damaged.

**Reading type is modelled on the correct axis.** An absolute, evidential qualifier belongs on the reading and exports as its TEI type: that it is an omission, too damaged to identify, only apparently this text, or not meaningful Greek. Its purpose is honest citation and filterability. Claims about how one reading stands relative to another — addition, substitution, transposition — are relational and belong on the arc, not the reading; they are deferred rather than mismodelled. Certainty is orthogonal to type and uses TEI's own certainty attribute.

**The Readings phase becomes partitioning witnesses among readings.** Readings are cards anchored by their letter; text is edited in place rather than inside permanent input boxes; subreadings nest visually inside their main reading. Witness sigla become selectable chips in one group spanning every card, because cross-card selection is what makes bulk work possible. With a selection active, contextual verbs offer what scholars actually do — move to a reading, split into a new reading, merge readings — once per gesture rather than once per witness. Rare operations move into a per-card menu and stop competing for attention. Establishing the lemma replaces one-position-at-a-time reordering as the primary ordering gesture.

**The lemma is discovered, not fixed.** It defaults to the reading the base text attests and can be elevated from any reading, which bumps the base text's reading down into the ordinary sequence. The set of established lemma readings is the edition being built, so the units where the lemma departs from the base text form a divergence report — a real scholarly payoff computed for free.

**The local stemma is a tree in the interface and an arc set in storage.** The interface presents and enforces the teachable model: each reading has one source decision — undecided, unclear, or derived from a named prior reading. Undecided and unclear are different states and only one is a claim; undecided never exports as though a scholar had considered it. Storage remains arc-based, so contamination and multiple emergence can arrive later without a schema change, with a projection presenting the tree and surfacing any reading with more than one source as an explicit warning rather than mis-drawing it. Subreadings collapse into their main reading's node, so the diagram makes exactly one claim.

**Automatic layout is what reconciles dragging with keyboard operation.** The conflict exists only when dragging means positioning. With a pure layout module owning all geometry, dragging can only mean reparenting — a tree operation with an exact keyboard equivalent, the bargain a file tree makes. Three input routes write one operation: dragging a node onto its source; lifting a node by keyboard, moving to its source, and placing it, with announcements; or a source menu in a parallel list, which is both the assistive-technology route and the fastest way to settle six readings. Nodes become real focusable controls layered over an arc-drawing surface, so focus and labelling come free and the accessibility suppressions are deleted rather than relocated.

**Connectivity becomes enterable**, per variation unit, alongside the local stemma, because in this method it is the same judgement about the same variant made at the same moment — and because an export carrying a default the scholar never saw asserts an editorial position on their behalf.

**The flow ends in a Review phase**: the finished apparatus for the verse, local stemmata together, the divergence report, a worklist of unresolved decisions linking back to the units responsible, and export. Export is reconstructive — agreed text is emitted alongside the variation, so every witness's text can be rebuilt from the apparatus rather than only its points of variance. Committing a version becomes the natural close of the work rather than a header button.

## User Stories

### Making editorial decisions that persist

1. As a scholar, I want to subordinate a variant to a main reading whose text differs from it, so that a form differing only by damage or orthography is cited where it belongs.
2. As a scholar, I want a subreading attachment I have made to survive my next edit, so that the apparatus reflects my judgement rather than string equality.
3. As a scholar, I want to see which groupings the reading proposal suggested and which I established, so that I can tell my own work from the machine's.
4. As a scholar, I want to change a regularization rule without losing the editorial decisions I have already made, so that refining normalization does not cost me my judgements.
5. As a scholar, I want to be told when a decision I made refers to a reading that no longer exists, so that a changed alignment does not silently discard my work.
6. As a scholar, I want to undo any readings or local stemma edit, so that I can explore a hypothesis without committing to it.
7. As a scholar, I want one gesture to undo as one step, so that reversing a bulk move does not take nine presses.
8. As a scholar, I want undo to take me back to the phase where the change happened, so that I can see what was reversed.
9. As a scholar, I want to be warned before an action discards reading text, so that I do not lose a transcribed reading to a menu selection.
10. As a scholar, I want a control that cannot perform what I selected to say so, so that I am never left believing an edit happened.

### Partitioning witnesses among readings

11. As a scholar, I want to select many witnesses and move them to another reading in one action, so that correcting a misgrouped reading costs one gesture.
12. As a scholar, I want to select witnesses across different readings at once, so that I can gather a reading the alignment split apart.
13. As a scholar, I want to split selected witnesses into a new reading, so that I can separate a distinction the alignment missed.
14. As a scholar, I want to merge two readings, so that I can undo a distinction the alignment over-drew.
15. As a scholar, I want to perform every one of those operations from the keyboard, so that the work does not require a pointer.
16. As a scholar, I want subreadings displayed inside their main reading, so that the relationship is legible without interpreting indentation.
17. As a scholar, I want to edit reading text in place, so that the screen is not a grid of input boxes.
18. As a scholar, I want to add a reading no witness attests, so that I can record a conjecture or an edition's reading.
19. As a scholar, I want to delete a reading only once nothing attests it, so that I cannot lose witness attestation by accident.
20. As a scholar, I want the rarely-used operations kept out of my way, so that the common ones are obvious.

### Establishing the lemma

21. As a scholar, I want the lemma to default to the reading my base text attests, so that I start from a sensible position without deciding anything.
22. As a scholar, I want to elevate any reading to the lemma, so that the edition I am establishing is not limited to what one witness reads.
23. As a scholar, I want the base text's reading to keep its place in the sequence when I elevate another reading, so that elevating a lemma does not hide the reading I am comparing against.
24. As a scholar, I want to see where my established lemma readings depart from the base text, so that I can review what my edition is actually claiming.
25. As a scholar, I want to be told when the base text does not testify at a unit, so that I know why there is no default lemma.
26. As a scholar, I want to designate the lemma explicitly at such a unit, so that a unit without base text testimony can still be completed.
27. As a scholar, I want reading order to be editorially adjustable, so that the sequence reflects my judgement and not only witness counts.

### Recording reading types and non-attestation

28. As a scholar, I want to record that a reading is too damaged to identify, so that later analysis can filter it out rather than treating it as evidence.
29. As a scholar, I want to record that a reading is only apparently the text I have given, so that my uncertainty is part of the record.
30. As a scholar, I want to record that a reading is not meaningful Greek, so that a scribal error is not mistaken for a variant worth weighing.
31. As a scholar, I want reading types proposed from the transcription's damage and uncertainty markers, so that I am not typing the same qualifier for every damaged witness.
32. As a scholar, I want to override any proposed reading type, so that the machine's guess never overrides my reading of the manuscript.
33. As a scholar, I want witnesses that do not testify shown separately from readings, so that absence is not mistaken for evidence.
34. As a scholar, I want to see which witnesses are absent at a unit, so that I know the true extent of my evidence.
35. As a scholar, I want untranscribed witnesses reported as unfinished work rather than as damage, so that my apparatus never claims a manuscript is damaged when it is merely untranscribed.
36. As a scholar, I want a project-specific reading type available when my project needs one, so that a fixed list does not constrain my editorial practice.

### Constructing a local stemma

37. As a scholar, I want to record that one reading arose from another, so that I can state a genealogical hypothesis.
38. As a scholar, I want to record that a reading's origin cannot be determined, so that I am not forced to assert a derivation I cannot defend.
39. As a scholar, I want undecided readings to look unanswered rather than merely unconnected, so that I can see what I have not yet considered.
40. As a scholar, I want the lemma to be the default root, so that the starting position is defensible rather than derived from witness counts.
41. As a scholar, I want to be warned when arcs make the lemma derive from something else, so that a contradiction is visible.
42. As a scholar, I want that warning not to rewrite my arcs, so that a labelling decision cannot destroy a genealogical one.
43. As a scholar, I want a one-click repair that reroots the stemma on the lemma, so that fixing the contradiction is cheap when I want it.
44. As a scholar, I want to keep working through an inconsistent intermediate state, so that the tool notices problems without forbidding thought.
45. As a scholar, I want the diagram laid out automatically, so that my attention goes to genealogy rather than to arranging boxes.
46. As a scholar, I want a stemma several generations deep to render legibly, so that the diagram stays usable for real units.
47. As a scholar, I want the diagram to make one claim rather than overlaying citation structure with genealogy, so that I can read it.
48. As a scholar, I want subreadings folded into their main reading's node, so that the stemma shows only what bears genealogical weight.
49. As a scholar, I want to drag a reading onto its source, so that the common case is fast.
50. As a scholar using a keyboard, I want to lift a reading, move to its source, and place it, so that no arc requires a pointer.
51. As a scholar using assistive technology, I want each reading's source settable from a labelled control in a list, so that the diagram is not the only route.
52. As a scholar using assistive technology, I want connection state announced as it changes, so that I know what is being joined to what.
53. As a scholar, I want to detach a reading and make it a root, so that I can retract a hypothesis.
54. As a scholar, I want to be told when a reading has more than one recorded source, so that an unsupported state is visible rather than silently mis-drawn.
55. As a scholar, I want to record connectivity for a unit, so that my judgement about independent emergence is part of the data.
56. As a scholar, I want the connectivity values editors actually use offered directly, so that a common judgement is one click and a typo cannot enter the record.

### Seeing the apparatus while building it

57. As a scholar, I want the unit I am editing rendered in conventional apparatus notation as I work, so that I can check decisions in the notation I think in.
58. As a scholar, I want that preview to match the export exactly, so that I never find a discrepancy afterwards.
59. As a scholar, I want to see which units still need attention, so that I have a worklist rather than a row of units to click through.
60. As a scholar, I want to see at a glance which readings have settled sources, so that progress within a unit is visible.

### Finishing a collation

61. As a scholar, I want a final phase showing the finished apparatus for the verse, so that the flow ends in the thing I was making.
62. As a scholar, I want to reach that phase before the work is complete, so that I can check my progress as I go.
63. As a scholar, I want the local stemmata shown together, so that I can review my genealogical decisions as a set.
64. As a scholar, I want a list of unresolved decisions linking to the units responsible, so that I can tell whether the collation is finished.
65. As a scholar, I want export refused where I have not decided, so that the file never states a judgement I did not make.
66. As a scholar, I want to export a TEI apparatus with witness attestation, so that the work is usable outside this application.
67. As a scholar, I want the agreed text exported alongside the variation, so that every witness's text can be reconstructed from my apparatus.
68. As a scholar, I want the export to validate against a published schema, so that compliance is verified rather than assumed.
69. As a scholar, I want to commit a version from the review phase, so that finishing the work and recording it are one gesture.
70. As a scholar working on a device running an older build, I want that build to refuse a newer collation outright, so that stale software cannot quietly discard my decisions.

## Implementation Decisions

### Vocabulary

The domain glossary is authoritative and was extended for this work: **main reading**, **subreading**, **arc**, **prior reading**, **posterior reading**, **lemma reading**, **local stemma**, **source decision**, **reading type**, **non-attestation**, **omission**, **untranscribed witness**, **connectivity**, **reading proposal**, **editorial decision**, **orphaned decision**.

The prior parent-attachment field and the normalized-text grouping view are **removed outright, not aliased**. A retained compatibility field is the specific thing that caused genealogy and citation structure to be conflated once already; leaving one in place invites the same error.

`source` is reserved throughout the collation modules for the transcription a witness came from, and must not be reused for the prior end of an arc.

### The proposal/decision split

Two representations, never one field with two meanings:

```ts
// Derived on read from alignment + collation settings. Never persisted as truth.
type ReadingProposal = {
  readings: ProposedReading[];        // includes proposed subreading grouping,
  nonAttestingWitnessIds: string[];   // provisional order, proposed reading types
};

// Sparse. Only what a scholar explicitly established. Persisted.
type UnitDecisions = {
  subreadingOf?: Record<ReadingId, ReadingId | null>;
  lemmaReadingId?: ReadingId | null;   // null/absent = derive from base text
  readingType?: Record<ReadingId, ReadingTypeId | null>;
  certainty?: Record<ReadingId, Certainty | null>;
  sourceDecision?: Record<ReadingId, SourceDecision>;
  order?: ReadingId[];
  text?: Record<ReadingId, string>;
  witnessAssignment?: Record<WitnessId, ReadingId>;
  addedReadings?: AddedReading[];
  connectivity?: number;
};

applyDecisions(proposal: ReadingProposal, decisions: UnitDecisions): UnitView;
```

`applyDecisions` is pure and is called on read. Nothing recanonicalizes on write. Decisions naming readings absent from the current proposal are **orphaned decisions**: reported in the returned view and surfaced in Review, never filtered away silently.

### Source decisions and arcs

```ts
type SourceDecision =
  | { kind: 'undecided' }              // default; not a claim; blocks export
  | { kind: 'unclear' }                // considered; origin undeterminable
  | { kind: 'derived'; from: ReadingId };
```

Storage stays arc-based so multiple sources remain expressible later without a schema change. A projection derives the tree, enforcing at most one source in the interface and reporting violations rather than rendering them. The per-arc directedness flag is dropped — direction is a property of the graph in the target format.

The lemma reading is the default root. Arcs making the lemma a posterior reading are a **reported contradiction**, not a rejected edit; a "reroot on lemma" repair is offered alongside the warning. Elevating a lemma never rewrites arcs.

### Non-attestation and reading types

Non-attestation is not a reading: excluded from lettering, ordering, subreading attachment, and the local stemma; rendered as a distinct pinned row whose witnesses are not selectable for move or merge. Omission remains a reading. Deficient text remains a reading carrying a reading type.

Untranscribed material is tracked separately from damage. It never serialises as non-attestation; it blocks export for the affected unit until transcribed or explicitly excluded.

Reading type is **single-valued** over an open, project-extensible vocabulary (omission, deficient, apparent, nonsense, orthographic, plus project additions), exporting as the reading's TEI type attribute — which the target schema leaves open-valued. Certainty is a **separate** field using TEI's certainty attribute (`high | medium | low | unknown`, or a number). Relational categories are not modelled; the prior classification field is removed, and stemma node colour encodes source-decision state instead.

Reading types are proposed from existing per-segment damage and supplied markers and from regularization rules already typed as nonsense, then confirmed or overridden. A subreading carrying no reading type is a Review nudge, not an error.

### Undo

Snapshot the decisions overlay; do not use undo/redo closures. Decisions are small and sparse, so a value copy is correct by construction and cannot become asymmetric. One history entry per user gesture. A single linear history extending the existing one, each entry recording its phase; undoing navigates to that phase first. In memory only — no second persisted representation of the collation, per existing project direction. History capped around 100 entries. Text edits continue to commit on blur rather than per keystroke.

**Undo covers editorial decisions only** — not phase navigation, unit selection, witness selection, display-mode toggles, or the base-text choice.

### Persistence and versioning

The application is not yet deployed, so **no upgrader is written**. The document format version is bumped so that the existing forward-version guard rejects newer documents on stale builds, and so that pre-change local documents fail loudly with a clear message instead of being silently misparsed and saved over. Phase normalization is additionally changed to clamp an unrecognised phase to the last known phase rather than to the first, because resetting it also resets furthest-phase and makes a completed collation present as untouched with every step locked.

Format fixtures carry content hashes that **must be recomputed, not hand-edited**; a regeneration path should be added, since none exists.

### Review phase

A real fifth step in the stepper — explicitly not following the pattern of the existing hidden phase that folds into its neighbour. Reachable once an alignment exists rather than gated on completing the local stemmata, because checking the apparatus is part of building it. Furthest-phase still advances so the stepper reads as complete. Export within Review is separately gated on undecided source decisions and untranscribed witnesses.

Contents: the verse apparatus, local stemmata together, the divergence report of lemma-versus-base-text departures, the unresolved-decision worklist linking back to units, export, and version commit.

### Segments and export

One module derives the sequence of agreed-text segments and variation units from the alignment. **Three surfaces consume it**: the basetext strip, the live apparatus preview, and the export. They must not each derive it, because divergence silently breaks reconstructability.

The apparatus exporter is a **new module**, not an extension of the transcription exporter: different input, different output, different consumer. It reuses only low-level escaping and serialisation. **Export only — no apparatus import**, despite round-tripping being the established pattern for transcriptions.

Serialisation contract:

- Agreed text is emitted so that every witness's text is reconstructible, not only its points of variance. This is unconditional. The dormant tokenization-adjacent segmentation setting is unrelated and stays untouched — neither wired up nor deleted.
- Subreadings are emitted **flat**, with the relationship carried by the label convention, per IGNTP practice. The TEI reading-group element is not used, and graph nodes join to readings by label — subreadings deliberately have no node.
- Omission is an empty reading element carrying an explicit omission type, which is a superset of both conventions found in the wild.
- Non-attestation is one reserved-label reading per unit, typed as lacuna, ordered last, and never a node.
- Undecided source decisions do not serialise; unclear serialises as the **absence** of an incoming arc, which is the only encoding available — no dedicated unknown-source node exists in the reference corpus.
- Nodes are emitted for every reading regardless of its source decision.
- Connectivity is emitted per unit as a feature structure.
- The lemma is emitted with the witnesses that actually attest it; the base text appears there only when it genuinely does.

### Schema validation

The vendored NT manuscripts schema is an **upstream submodule and must not be modified**. It is a transcription schema: it admits apparatus elements but not the graph or feature-structure modules, so local stemmata and connectivity cannot validate against it. Collation output is therefore validated against **TEI P5 all-modules**, which is also the only schema the reference corpus can be valid against, since those files contain graph elements. The existing transcription validator is left untouched; a sibling validator reuses the same Python-based harness with a different schema.

### Interaction contracts

**Readings phase.** Reading cards anchored by letter; text edited in place; subreadings nested within their main reading. Witness sigla are a **single selection group spanning all cards**, as a roving-tabindex group supporting toggle and range extension. Verbs act on the whole selection: move to reading, split into new reading, merge. Rare operations live in a per-card menu. Reordering, when refused, explains itself.

**Stemma phase.** All geometry comes from a pure layered-layout module returning node positions and arc paths, with the viewport fitted to computed bounds. Nodes are focusable controls layered over an arc-drawing surface — not interactive graphics with suppressed accessibility lint. One tabstop for the diagram with arrow-key movement inside it. Three input routes write the one source-decision operation: drag onto target; keyboard lift-move-place with live-region announcements; and a source menu in a parallel list. Dropping on empty space detaches to root. Free node positioning is **specifically excluded** — it is what makes accessible graph editing impossible and nothing in the domain needs it.

## Testing Decisions

A good test here fixes external behaviour: what a scholar can observe through the collation state store's public interface, or what a pure function returns for given input. Tests must not assert on internal shapes, on how many times something recomputes, or on private helpers. Where a decision was made because a silent failure was possible, the test asserts the *loud* behaviour — that export refuses, that a warning is reported, that a stale build throws.

**Primary seam — the collation state store.** Existing node-project specs already exercise this heavily and carry the bulk of new coverage: subreading attachment across differing text, decision durability across proposal rebuilds, orphaned-decision reporting, lemma default and elevation with base-text bumping, source decisions including undecided-versus-unclear, reading type proposal and override, connectivity, bulk witness moves, splits, merges, non-attestation exclusion from lettering and ordering, undo granularity and scope, and the lemma-as-posterior contradiction being reported rather than rejected.

**Three pure-module seams**, each with direct prior art among the existing collation and TEI specs:

- **Decision overlay** — `applyDecisions` against a fixed proposal: precedence of decisions over proposal, sparseness, orphan detection, and idempotence.
- **Local stemma layout** — positions and paths only: multi-generation depth, computed bounds, collapsed subreadings, deterministic output for equal input.
- **Segment/apparatus renderer** — the shared derivation: agreed-text segments versus variation units, and apparatus notation matching what the exporter emits. The **shared-ness is itself the invariant** and is asserted directly, because divergence is what would silently break reconstructability.

**Export validation.** Following the existing real-export validation spec: generate an apparatus and validate it against TEI P5 all-modules through a sibling of the existing validator. Assert reconstructability structurally — that walking the exported apparatus rebuilds each witness's text. Assert that export refuses undecided units and untranscribed witnesses.

**One Playwright spec for the epic**, named after it, following the established one-spec-per-epic pattern. It covers what cannot be tested below the browser: cross-card chip selection, bulk move by keyboard, keyboard lift-move-place arc creation, live-region announcements, single-tabstop diagram navigation, and the flow through to Review and export. This is the one place the contract is verified further from the code than elsewhere, which is accepted because focus and announcement behaviour is genuinely integration-level.

## Out of Scope

- **Coherence computation and the CBGM proper** — pre-genealogical coherence, textual flow, global stemma. This epic builds the data entry substrate they require.
- **Multiple sources and contamination in the interface.** Storage keeps them expressible; the interface presents one source per reading and warns on violations.
- **Relational variation typology** (addition, substitution, transposition). Deferred to arc labels, where it is meaningful and exportable.
- **Apparatus import.** Reconciling a foreign apparatus against local witnesses and alignment is larger than this entire epic.
- **The TEI reading-group element** for subreadings. Noted as intended future serialisation; flat output is current IGNTP practice.
- **Collating more than a verse at a time.**
- **Changing tokenization, regularization, or the alignment algorithm.** Reading types are proposed from markers that already exist.
- **Wiring up or deleting the dormant segmentation setting.** It is unrelated to agreed-text emission and stays as it is.
- **A general-purpose graph editor** or free node positioning.
- **Reworking Setup or Alignment.** The basetext strip is retained.
- **Format upgraders.** The application is not deployed; the version bump exists to fail loudly, not to migrate.
- **Persisted undo.**

## Further Notes

The reference corpus in the repository and the reference implementation's examples are the same passage, so the repository's example file is that corpus with its local stemmata unfilled. Producing those arcs is precisely the gap this epic closes. Both lack the agreed-text segments and the lemma that this application will emit, which is a deliberate improvement rather than a divergence: without agreed text, an apparatus records only where witnesses differ, and no witness's text can be reconstructed from it.

One research question remains and gates nothing: whether tooling accepts a non-numeric unlimited connectivity value. If it does, connectivity should be widened at the point it is introduced rather than later.

The unclear-source encoding is settled by **inference from absence** rather than positive confirmation: the reference corpus's completed local stemmata give every non-root reading an incoming arc and contain no unknown-source node, and the reference implementation documents unclear sources as breaking substemma optimisation. If a positive counter-example surfaces, the export mapping for unclear is the only thing that changes.
