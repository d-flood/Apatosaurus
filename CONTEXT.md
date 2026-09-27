# Apatosaurus

A local-first progressive web app for New Testament textual criticism: scholars transcribe manuscripts, then collate transcriptions to analyze textual variants. Projects group transcriptions and collations and own their collation settings.

## Language

### Navigation

**Open project**:
The project a user is currently working inside. On project-scoped pages, identified solely by the project id in the URL — never by hidden app state.
_Avoid_: Current project, selected project, active project

**Last-opened project**:
The remembered id of the project most recently opened, used only to construct links (navbar, redirects) when no project is in the URL. Never a source of truth for what a page displays.

**Project-scoped page**:
A page about a project (its document lists, settings, location). Its URL carries the project id.

**Document page**:
An editor page addressed by document id alone. Its project is derived from document ownership, never from the URL or navigation history.

**Dashboard**:
The home page (`/`): recent documents to resume, attention items, and creation shortcuts. The app's re-entry point for returning scholars.
_Avoid_: Home page, landing page

**Data & Storage page**:
The app-wide surface for storage accounts and project locations, storage durability, whole-account export, and database repair. The single click-through target for sync status. Where one project lives, and moving it, belongs to that project's pages, never here.

### Transcription

**Reference edition**:
A published critical edition a scholar can seed transcriptions from, either bundled with the app or supplied by the user. Addressed by its own book/chapter/verse milestones, whose values the app never interprets. Never a witness and never collated.
_Avoid_: Base text, basetext, exemplar

**Seeding**:
Inserting a contiguous milestone range of a reference edition into a transcription at a position. Produces an ordinary transcription; no new kind of document exists.
_Avoid_: Bootstrapping, importing

**Unconfirmed text**:
Seeded text a human has not yet checked against the manuscript. Clears when the text is edited or when its verse is explicitly reviewed — so it means "nobody has looked at this", not "this came from an edition".
_Avoid_: Unreviewed, provisional, draft

### Collation

**Collation segment** — a named set of verse identifiers a collation treats as one unit of text, so that witnesses using different reference conventions can be collated together. The scholar asserts the equivalence and supplies the name; the app never infers either. Its name is the only reference that appears in output.
_Avoid_: Collation unit (a variation unit is a place within a segment), verse group, alias.

**Base text**:
The witness of a collation against which variants are cited. Unrelated to a reference edition.

**Collation settings**:
Project-owned configuration for how collation interprets the project's witnesses: regularization rules, normalization toggles, witness treatments, and excluded hands. Lives on the project Settings page, not in the transcription library.

**Project transcription library**:
The project-scoped list of transcriptions a scholar works from — open, create, delete. Carries no collation configuration.

**Variation unit**:
A place within a collation segment where the witnesses differ, and the scope everything editorial hangs from — its readings, its local stemma, its connectivity. Identified by the alignment column it covers, never by its position among the units: reshaping the alignment elsewhere must not change which unit a scholar's decision belongs to. A unit whose column is gone does not move; it orphans.
_Avoid_: Variant unit, unit (unqualified), alignment column (the column is the mechanism, the unit is the concept)

**Main reading**:
A reading cited in its own right at a variation unit, labelled with a letter (`a`, `b`, `c`). Carries any subreadings of it.
_Avoid_: Parent reading, primary reading

**Subreading**:
A reading recorded separately from its main reading but treated as equivalent to it, and counted with it in analysis — typically a form differing only in damage, uncertainty, or orthography. Labelled from its main reading (`a1`, `a2`). Never a genealogically distinct variant.
_Avoid_: Child reading, nested reading, reading family

**Lemma reading**:
The reading a scholar establishes as `a` at a variation unit — the initial text's reading. Defaults to the reading the base text attests, and may be elevated from any reading, which bumps the base text's reading down into the ordinary letter sequence.
_Avoid_: Lemma, main reading (a main reading is any lettered reading), base reading

**Reading proposal**:
The readings, subreading groupings, and provisional order that the alignment and regularization settings imply on their own, before any scholar has judged them. Always recomputable, never authoritative.
_Avoid_: Auto readings, generated readings, default readings

**Editorial decision**:
Something a scholar has explicitly established about a variation unit — a subreading attachment, a lemma elevation, a source decision, an order, a text correction, a split or merge. Outranks the reading proposal and survives realignment.
_Avoid_: Override, manual edit, user change

**Orphaned decision**:
An editorial decision naming a reading that no longer exists, typically after regularization or alignment changed. Surfaced for the scholar to resolve, never silently discarded.
_Avoid_: Stale decision, broken override

**Source decision**:
A scholar's answer to where a non-lemma reading came from: undecided, unclear, or derived from a named prior reading. Undecided is the absence of an answer and is never reported as a judgement; unclear is the considered judgement that the origin cannot be determined.
_Avoid_: Unknown source, unassigned parent

**Local stemma**:
The scholar's hypothesis about how the readings at one variation unit gave rise to each other: a set of arcs over that unit's readings, rooted by default on the lemma reading. Scoped to a single variation unit — never across units.
_Avoid_: Stemma (unqualified), reading graph, variant tree

**Connectivity**:
A scholar's judgement, recorded per variation unit, of how many generations of intermediary witnesses may separate two attestations of a reading before their agreement stops counting as evidence of relationship. Lowered for readings likely to have arisen independently.
_Avoid_: Coherence value, connection strength

**Reading type**:
An evidential qualifier on a reading, standing on its own without reference to any other reading — that it is an omission, is too damaged to identify, is only apparently this text, or is not meaningful Greek. Exists so that later analysis can cite honestly and filter readings out. Never holds a claim about how one reading relates to another.
_Avoid_: Reading classification, reading category

**Non-attestation**:
The witnesses that do not testify at a variation unit because their text is damaged, lost, or illegible. Not a reading: it takes no letter, holds no subreadings, and never appears in a local stemma.
_Avoid_: Lacuna reading, gap reading, empty reading

**Omission**:
A reading whose witnesses attest the absence of text at a variation unit. A genuine variant — it takes a letter and may stand at either end of an arc.
_Avoid_: Blank reading, null reading

**Untranscribed witness**:
A witness whose transcription does not yet cover a variation unit. A fact about project progress, never reported as non-attestation, because that would assert damage to the manuscript that may not exist.
_Avoid_: Missing witness, lacunose witness

**Arc**:
The genealogical relation between two readings at a variation unit: an editorial hypothesis that one reading gave rise to another. Runs from a prior reading to a posterior reading.
_Avoid_: Edge, link, connection

**Prior reading**:
The reading an arc runs from — the one hypothesised to have given rise to the other.
_Avoid_: Parent, ancestor, source reading (`source` means the transcription a witness came from)

**Posterior reading**:
The reading an arc runs to — the one hypothesised to have arisen from the prior reading.
_Avoid_: Child, descendant, derived reading

### Versions and storage

**Version**:
A named, unchanging record of one document's content at a moment the scholar chose, with an optional note. A document has exactly as many versions as the scholar has named.
_Avoid_: Commit, checkpoint, snapshot, revision

**Current**:
A document's content as it stands now, saved automatically as the scholar works. Never a version, even when its content matches one.
_Avoid_: Latest, working copy, draft, HEAD

**Storage account**:
A signed-in identity with a cloud storage provider, such as one Google or Dropbox account. A scholar may have several at once.
_Avoid_: Connection, login, provider (the provider is the company)

**Project location**:
A folder holding a scholar's or a team's projects, either in a storage account or on this computer. Each project lives in at most one.
_Avoid_: Sync target, sync folder, remote, destination

**Personal location**:
The project location a storage account gets for its owner alone when the scholar first signs in.

**Team location**:
A project location shared with other scholars through their storage provider. Deleting a project there deletes it for everyone.
_Avoid_: Shared drive (a provider feature, not ours), workspace

**Browser-only project**:
A project with no project location; it exists only in this browser.
_Avoid_: Local project, unsynced project

**Move**:
Transferring a project and all its versions into a project location, from another location or from this browser alone, after which the old place is no longer used and anyone still using it is told the project has moved. Never leaves the project in two places.
_Avoid_: Mirror, migrate, copy

**Collision**:
Two copies of a document's Current that changed independently, from two people or two devices, since they last agreed.
_Avoid_: Conflict (reserve for the resulting copy), merge conflict

**Conflict copy**:
The document a collision produces from the side that arrived second, kept whole until the scholar reconciles it. Nothing in a collision is silently discarded.
_Avoid_: Duplicate, backup copy

**Editing notice**:
A warning that someone else, or you on another device, has recently been editing the document you are opening. Informs; never blocks.
_Avoid_: Lock, checkout, presence

**Witness source**:
Where a witness's text was taken from: a named version of a transcription, or its Current at a recorded moment. The collation keeps its own copy, so later edits to the transcription never move the witness until the scholar refreshes it.
_Avoid_: Pinned revision, source checkpoint
