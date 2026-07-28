# Reference Editions

## Problem Statement

Transcribing a manuscript in Apatosaurus means typing every character by hand. A scholar working through a folio of Romans types out text that is, for most of its length, identical to text that already exists in a dozen published editions. The labour is enormous, it is the least interesting part of the work, and it is where transcription errors are introduced — a mistyped word that nobody entered deliberately is indistinguishable, downstream, from a genuine manuscript reading.

What a scholar actually wants to do is start from a known text and *edit it*: insert the line and page breaks the manuscript has, change the words the manuscript differs on, and mark up the damage, corrections, and abbreviations the manuscript carries. The typing that remains is then the typing that is genuinely about *this* manuscript.

Nothing in the app supports this. The bundled IGNTP corpus contains one such text — the NA28 base text — but it cannot be imported at all: as a printed edition it has no manuscript identifier, repository, or settlement in its header, and transcription creation requires all three. It is also under active German Bible Society copyright, with a header that explicitly forbids internet distribution, and it is currently committed to this repository and served publicly.

The problem generalises past the New Testament. Scholars work on other corpora, in other languages, from editions the app will never bundle. And it generalises past continuous texts: a lectionary's contents are not in canonical order, so "seed the whole book once at creation" is not a workflow that fits.

## Solution

Introduce the **reference edition**: a published critical edition, bundled with the app or supplied by the user, that a scholar can **seed** text from into a transcription.

Seeding inserts a contiguous range of a reference edition's milestone-addressed units at a position in a transcription. It happens inside the editor, so a scholar can seed the verses on the folio in front of them, break them into lines, and move on to the next folio — rather than seeding a whole book and chopping it up. Creation-time seeding is the same operation applied to an empty document.

Seeded text arrives as **unconfirmed text**: text no human has yet checked against the manuscript. The mark clears when the scholar edits the text, or when they explicitly review a verse they have checked and found to agree. This closes the failure that makes the feature dangerous rather than merely convenient — a half-finished transcription whose untouched regions silently assert that the manuscript agrees with a printed edition, producing manufactured agreement in exactly the dimension textual criticism measures.

Because the app cannot control how users package their editions, the only contract a reference edition source must satisfy is: yield an ordered list of milestone-addressed units, and extract a contiguous range of them. Size, file count, and internal division are unknown.

Ordinary clipboard paste into the editor is supported as an immediate stop-gap for scholars who have text but no edition file, and pasted text carries the unconfirmed mark on the same terms, so the safety invariant has no hole at its most-used entry point.

The encumbered NA28 file is removed from the repository. Robinson-Pierpont ships bundled. Everything else the scholar brings themselves.

## User Stories

### Seeding

1. As a scholar, I want to insert a range of a reference edition at my cursor, so that I can start from a known text instead of typing every character.
2. As a scholar transcribing folio by folio, I want to seed just the verses on the folio in front of me, so that my document grows in step with the manuscript I am reading.
3. As a scholar, I want to seed repeatedly at different points in one transcription, so that I can work through a manuscript in the order its pages present the text.
4. As a scholar transcribing a lectionary, I want to seed the same verses at more than one point, so that I can transcribe a manuscript whose contents are not in canonical order.
5. As a scholar creating a new transcription, I want to seed it immediately, so that I do not have to create an empty document and then find the seeding action.
6. As a scholar, I want seeded text to arrive without line, column, or page breaks, so that the structure in my document describes my manuscript and not somebody else's.
7. As a scholar, I want seeding never to change my transcription's page, column, or line structure, so that inserting text cannot silently rearrange work I have already done.
8. As a scholar, I want seeded text to carry its book, chapter, and verse milestones, so that the verse index and collation can find it without my re-entering references by hand.
9. As a scholar, I want seeding never to overwrite my transcription's title, siglum, transcriber, repository, settlement, or language, so that my transcription never claims to be the edition I seeded from.
10. As a scholar, I want to undo a seeding insertion, so that a mistaken range costs me one keystroke rather than manual deletion.

### Choosing what to seed

11. As a scholar, I want to browse a reference edition by its structural levels, so that I can find a passage without knowing the edition's internal reference syntax.
12. As a scholar working in an edition that only has one level of division, I want the picker to show one level, so that I am not confronted with empty controls for structure my edition does not have.
13. As a scholar, I want to select a start and end unit, so that I can seed exactly the passage I need.
14. As a scholar, I want to seed a single verse, so that I can fill one gap without a range.
15. As a scholar, I want to see the text of my selected range before I insert it, so that I do not insert several hundred verses into the wrong place.
16. As a scholar, I want the picker to reopen where I last left it, so that seeding folio after folio does not restart at the beginning of the book every time.
17. As a scholar, I want to see which edition I am seeding from and its attribution, so that I know whose text I am about to put in my document.
18. As a scholar seeding from an edition that repeats a reference, I want to select the occurrence I actually clicked, so that I get the text I saw rather than a different passage with the same label.

### Unconfirmed text

19. As a scholar, I want seeded text to be visibly marked as unconfirmed, so that I can see at a glance how much of my transcription I have actually checked.
20. As a scholar, I want the unconfirmed mark to disappear from text I edit, so that correcting a word registers as having checked it.
21. As a scholar, I want editing one word to clear the mark on that word only, so that fixing a single word is not mistaken for reviewing a whole verse.
22. As a scholar, I want text I type next to unconfirmed text not to become unconfirmed itself, so that my own typing is never flagged as somebody else's.
23. As a scholar whose manuscript agrees exactly with the edition, I want to mark a verse reviewed without changing it, so that doing the job correctly leaves a clean document.
24. As a scholar, I want to toggle the display of unconfirmed text, so that I can read my transcription without the highlighting when I want to.
25. As a scholar, I want to see how many verses in my transcription are still unconfirmed, so that I know how much work remains.
26. As a scholar returning after a break, I want to find the unconfirmed regions quickly, so that I can resume where my checking stopped rather than where my typing stopped.
27. As a scholar, I want the unconfirmed mark to survive closing and reopening the app, so that my checking progress is not lost between sessions.

### Pasting

28. As a scholar with text but no edition file, I want to paste text into the editor, so that I can bootstrap without waiting for a reference edition to exist.
29. As a scholar, I want pasted text to become properly separated words, so that it behaves like text I typed.
30. As a scholar, I want pasted text to be marked unconfirmed, so that the quickest way to get text into a transcription is not also the way that escapes checking.

### Bundled reference editions

31. As a scholar, I want a reference edition bundled with the app, so that I can seed without sourcing a file first.
32. As a scholar working offline, I want to seed from an edition I have used before, so that a flight or a reading room without wifi does not stop my work.
33. As a scholar, I want seeding not to freeze the editor while an edition loads, so that a large edition does not cost me a lost keystroke.
34. As a scholar, I want to see all available editions in one list regardless of whether they shipped with the app or I supplied them, so that I do not have to remember where each came from.

### Bringing your own edition

35. As a scholar, I want to add my own edition file, so that I can work on a corpus or from an edition the app does not bundle.
36. As a scholar who owns a licensed edition, I want to use it locally, so that I am not restricted to editions the app is permitted to distribute.
37. As a scholar, I want my added editions available across all my projects, so that I add an edition once rather than per project.
38. As a scholar, I want a clear message when my file cannot be used as a reference edition, so that I can fix the file rather than guess.
39. As a scholar, I want to be told specifically when my file has no addressable divisions, so that I understand what a reference edition needs.
40. As a scholar, I want a failed registration to leave nothing behind, so that a bad file does not clutter my edition list.
41. As a scholar, I want to be warned when I add an edition I already have, so that I do not end up with duplicates.
42. As a scholar, I want my added editions included in my whole-account export, so that my setup survives moving to a new machine.
43. As a scholar restoring a project on a new machine, I want a clear prompt to supply an edition I have not added there yet, so that a missing edition does not read as lost data.
44. As a scholar sharing a project archive with a colleague, I want my added editions not to be included, so that I do not redistribute an edition I am not licensed to share.

### Attribution and export

45. As a scholar, I want my transcription to record which editions it was seeded from, so that I can attribute them when I publish.
46. As a scholar, I want that record to survive my editing the text, so that attribution does not disappear as the work progresses.
47. As a scholar, I want the editions I seeded from to appear in my exported TEI header, so that attribution travels with the file.
48. As a scholar, I want unconfirmed text to be marked in my exported TEI, so that anyone reading my file knows which parts I have not checked.
49. As a scholar, I want re-importing a TEI file I exported to restore its unconfirmed marks, so that a backup round trip does not silently launder unchecked text into apparently-checked text.
50. As a scholar, I want a warning when I export a transcription containing unconfirmed text, so that I know what I am publishing.
51. As a scholar, I want that warning not to block the export, so that I can export drafts freely.
52. As a scholar, I want my exported TEI to stay schema-valid whether or not it contains unconfirmed text, so that the file works with other tools.

### Licensing hygiene

53. As a maintainer, I want no encumbered text distributed from this repository, so that the project is not redistributing copyrighted material.
54. As a maintainer, I want the bundled editions to be ones the project is permitted to distribute, so that the licensing position is defensible.
55. As a scholar, I want to see an edition's attribution requirements where I choose it, so that I can meet them.

## Implementation Decisions

### Domain vocabulary

Terms are recorded in the project glossary. In summary:

- **Reference edition** — a published critical edition available for seeding, bundled or user-supplied. Never a witness, never collated.
- **Seeding** — inserting a contiguous milestone range of a reference edition into a transcription at a position.
- **Unconfirmed text** — seeded or pasted text no human has yet checked against the manuscript.
- **Base text** — unchanged, and reserved for its existing meaning: the witness of a collation against which variants are cited.

The collation `isBaseText` flag is **not** renamed. The better vocabulary would give "base text" to the new concept and rename collation's to "base witness", but that flag is read directly off persisted collation documents, so renaming it costs a canonical-format migration. The risk budget for this epic is spent on the unconfirmed mark instead.

### Addressing and extraction

A reference edition is an ordered sequence of units addressed by the transcription model's existing three-level milestone structure (book / chapter / verse). Those level names are biblical but their **values are never interpreted** by the app — the parser already treats them as opaque strings, and this epic must not change that.

Consequently:

- Ordering and contiguity come from document order in the edition, never from comparing or computing on label values. No reference parser, no chapter arithmetic.
- Within one picker interaction, the selection handle is **positional** in the unit list. The milestone label is what is displayed and what rides into the inserted content. This makes an edition with repeated references usable rather than rejected, and guarantees the scholar gets the row they clicked.
- The picker renders **only the levels the source actually has**, degrading to two levels or one. It never assumes three.

The reference edition source contract is deliberately minimal, because packaging is outside the app's control:

```
listUnits(source)            -> ordered units, each with a milestone label and content
extractRange(source, a, b)   -> flat line-item content for units a..b inclusive (a may equal b)
```

Size, file count, and internal division are unspecified. Bundled editions may be packaged per book or otherwise; that is a packaging convenience, not a contract.

### Parsing

Reference editions are parsed off the main thread. Both bundled and user-supplied editions go through the **same** existing TEI import path — there is no build-time derived format. A single parse path is worth more than the parse cost, because two paths would drift; converting to a derived format later stays a contained change precisely because both sources share one function.

### Structure flattening

Page, column, and line breaks in a reference edition are dropped on extraction. Extraction produces flat line-item content, and the transcription model has no representation for a break inside a line's items anyway — breaks are the edges between containers. Preserving them would require deliberate extra code to split the target's lines around a live cursor.

The justification is not merely mechanical: line breaks in a manuscript transcription used as a reference edition describe *that* manuscript's layout. Carrying them into a transcription of a different manuscript asserts something false, and leaves the scholar deleting breaks as well as adding them.

Seeding therefore never changes the target's page, column, or line structure. It changes only the items within one line.

### Unconfirmed text

A new text mark, added to the transcription AST's mark union, mapped in both directions of the ProseMirror adapter, and registered in the editor schema. Its meaning is **"not yet confirmed against the manuscript"** — a statement about human attention, not about provenance. Provenance decays as text is edited; confirmation status does not.

Clearing rules, both of which are contracts and need tests rather than comments:

- The mark is **non-inclusive**. Text typed at a marked range's boundary or interior does not inherit it. ProseMirror marks are inclusive by default, so the naive implementation does the opposite of what is required.
- **Editing clears only the touched text run**, not the enclosing verse. Fixing one word in a verse is not reviewing the verse.

Because agreement between manuscript and edition is common and correct, edit-clearing alone would permanently over-report. A scholar can therefore explicitly **review a verse** without changing it, clearing the mark across that verse. The verse is the review unit because it matches the milestone seeding inserts by, matches what collation gathers, and is a unit scholars name.

Adding a mark member will stop the normalizer merging adjacent seeded and edited text runs. That is correct behaviour, but it changes normalization output and existing expectations may move.

### TEI export and import

Unconfirmed text serializes as `<seg type="unconfirmed">`, which is schema-valid under the manuscripts schema. It is not dropped.

The importer must parse `<seg type="unconfirmed">` **back into the unconfirmed mark, not into the generic TEI-span mark**. The generic span is the catch-all for arbitrary wrappers and is the path of least resistance; taking it produces a round trip whose XML compares equal while the semantic flag is gone and the editor shows nothing. The round-trip test must assert the mark type, not XML equality.

Export emits a **non-blocking** warning when the transcription contains unconfirmed text. Export is never blocked: scholars export drafts constantly, and a blocking gate would train them to clear marks to dismiss the dialog, destroying the signal.

### Provenance and attribution

The transcription record stores the **set of reference editions it was ever seeded from** — identities only, no ranges. This is the one piece of provenance that stays true forever, which is what attribution needs and what the unconfirmed mark deliberately cannot provide. Range-level provenance is explicitly rejected: it goes stale the moment text is edited, split, or deleted.

The set is rendered into the exported TEI header's source description. Each catalog entry carries an attribution string, shown in the picker and used to build that line. Bundled entries get theirs from the catalog generator; user-supplied entries take theirs from the file's own availability statement when present, and prompt the user otherwise.

Seeding writes **no other** record metadata. Not title, siglum, transcriber, repository, settlement, or language. This is the opposite of the existing TEI import path, which deliberately prefills those fields.

### Catalog

One runtime catalog assembled from two sources, distinguished by a source discriminator (`bundled` | `user`). Both appear in one list. The bundled source reads a generated manifest; the user source reads locally registered editions. The shape exists from the first ticket even while the user branch returns nothing, so bring-your-own fills in a branch rather than growing a parallel catalog with its own list UI and import panel.

Reference editions are a **separate** catalog from the IGNTP witness catalog, which they superficially resemble. The IGNTP catalog lists manuscript witnesses transcribed by a project; a printed critical edition is categorically not that — which is why the NA28 entry fails the witness required-field check today rather than by accident.

### Registration rules for user-supplied editions

- Non-XML or non-TEI input is rejected with the parse error surfaced, not swallowed.
- A file with **no milestones at all** is rejected, with a message naming what is missing. Accepting it would permit only "insert the entire edition", which is the undifferentiated blob this feature exists to prevent, and on a large file an editor freeze rather than a mistake.
- A file with **repeated milestone references** is accepted. Positional selection makes this a non-event.
- A range whose start and end are the same unit is valid.
- Failed registration leaves no partial catalog entry.
- Re-registration of the same edition is detected, using an identity rule of its own. The existing witness duplicate-key helper keys on siglum-or-title and must not be reused.

### Storage

User-supplied editions live at app level in the canonical file store, alongside other app-scoped state — not inside project folders. They are shared across projects and deduplicated.

They are included in the **whole-account export** on the Data & Storage surface, and deliberately **excluded from per-project archives**. Project archives get handed to colleagues; editions inside them would silently redistribute whatever the scholar seeded from, rebuilding the licensing problem this epic removes, one user at a time.

Extending whole-account export to include a non-project directory is a change to backup code and warrants its own tests.

A project restored on a second machine will reference an edition that is not present. Attribution still works, since the record stores the edition's identity rather than the file. Re-seeding prompts the scholar to supply the file, and needs a named, unalarming empty state so it does not read as data loss.

### Paste

Clipboard paste into the transcription editor produces text with word separation, and carries the unconfirmed mark under the same rules as seeded text. The invariant is stated without exception: **text that entered the document from outside is unconfirmed until a human confirms it, regardless of how it got in.** An invariant with a carve-out for the most-used entry point is not an invariant.

### Licensing

The NA28 base text file is deleted from static assets and from git, and the IGNTP catalog regenerated. It is the only encumbered file in the corpus — a survey of every availability statement found 157 CC BY 4.0, 9 CC BY-NC-SA, and one German Bible Society copyright with an explicit prohibition on internet distribution.

Robinson-Pierpont is bundled. No encumbered text is distributed from this repository. Editions the project cannot distribute reach scholars through bring-your-own, which is why bring-your-own is load-bearing rather than a nicety — and is required regardless, since the app will never bundle editions for every corpus.

## Testing Decisions

Good tests here assert **external behaviour**: what a scholar does and what comes out. The mark's clearing semantics in particular must not be tested by driving ProseMirror transactions directly — that tests the implementation, in the area most likely to be reworked. "Type a letter, export, the mark is gone from that word" stays true however invalidation is done.

All four seams already exist in the codebase. No new seam is introduced.

**Primary seam — editor harness to exported TEI.** Following the established pattern of the toolbar-insertion and inspector-carrier browser specs: render a harness component, drive real toolbar and picker affordances, assert on serialized TEI rendered into a test id. This one seam covers seeding, picker selection and degradation, preview, the unconfirmed mark, clearing on edit, non-inclusive behaviour, per-verse review, and paste. Requires a new harness component alongside the existing two, and a small fixture reference edition.

**TEI round-trip.** Extends the existing transcription-package suites. Unconfirmed text serializes to `<seg type="unconfirmed">`, parses back to the mark and specifically **not** to the generic span mark, and remains valid against the manuscripts schema. Prior art: the fixture, XSD, and editor-conformance specs in that package.

**Reference edition source interface.** Node-side unit tests over pure functions: unit listing, range extraction, inclusive single-unit ranges, level degradation, rejection of sources without milestones, tolerance of repeated references. Prior art: the TEI importer and imported-summary specs.

**Catalog and storage.** Extends the existing store suite against the in-memory backend: bundled and user sources merging into one list, registration atomicity, edition identity and duplicate detection, and whole-account export including editions while project archives exclude them. Prior art: the OPFS store and sync-target specs.

## Out of Scope

- **Renaming the collation `isBaseText` flag** or touching the collation document format.
- **Lectionary duplicate-verse handling.** Verse indexing enforces one row per transcription and verse, and witness token extraction concatenates every region matching a verse across the whole document — so a manuscript containing a verse twice already collates as one concatenated reading. This is pre-existing, independent of reference editions, and needs its own investigation.
- **A collation guard on unconfirmed witnesses.** Warning or refusing to collate witnesses with unconfirmed regions is a natural follow-on once the mark exists; it is not in this epic.
- **Modifying the IGNTP witness import path or its catalog**, beyond regenerating the catalog after the NA28 deletion.
- **A utility to "clean" an existing transcription into a reference edition.** Goes to the ideas backlog.
- **Explicit offline pre-caching of reference editions**, with visible storage use and eviction. Editions are cached on first use by existing asset caching. Deliberate offline management belongs with the image-caching item already on the ideas backlog, on the Data & Storage surface.
- **Blocking TEI export** on unconfirmed text.
- **Multi-range selection in one insertion.** Non-contiguous needs are met by repeated insertion.
- **A build-time derived index format** for reference editions.
- **Orthographic normalization on seeding** — stripping diacritics, changing case, removing punctuation. Editions are seeded verbatim; curation is handled in the source files, not in parsing policy.

## Further Notes

**The critical path is the risk.** The unconfirmed mark gates paste, seeding UI, bring-your-own, and export. It is also the riskiest work in the epic: mark invalidation lands in the part of the editor that already required dedicated selection-stability tests and two remediation tickets. The reference edition model and bundled catalog are genuinely independent and can proceed in parallel; that is the only available mitigation short of shipping seeding unmarked first, which is rejected because retrofitting would leave already-seeded text permanently untrusted but unflagged.

**Verbatim has exactly one carve-out.** Reference editions are seeded exactly as their source files have them — including edition-private word attributes such as lemma and numbering — on the principle that curation is a data problem the maintainer solves in the source files. The single exception is structural flattening, which drops layout claims about a different physical object rather than textual content. Users supplying their own editions receive exactly the file they supplied, which is the least surprising behaviour available.

**Candidate architecture decision records**, each hard to reverse, surprising without context, and the result of a genuine trade-off:

1. Unconfirmed text tracks *confirmation* rather than *provenance* — why editing clears it, why explicit review exists, why range-level provenance was rejected.
2. User-supplied editions are app-scoped and excluded from project archives — the redistribution argument.
3. "Reference edition" rather than "base text" — why the better vocabulary was declined, and what it would cost to change.
