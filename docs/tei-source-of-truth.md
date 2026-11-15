# TEI files as the source of truth

Status: accepted (switch confirmed); details below are proposed.

Each transcription and each collation is one TEI P5 file. That file is the only canonical copy of the
document: it is what the app writes, what sync and location folders mirror, what other tools (Oxygen,
the IGNTP tooling, open-cbgm) read and edit, and what the SQLite index is rebuilt from. The sealed JSON
documents (`transcriptions/<id>.json`, `collations/<id>.json`, their history files) are retired.

## Principles

- **Everything the app persists about a document lives in its TEI file**, encoded in TEI P5 elements.
  No JSON is embedded. App state with no standard TEI encoding uses TEI feature structures (`<fs>`).
- **Project configuration stays in `project.json`**: membership, collation settings, reading-type and tag
  vocabularies, manual witness definitions. It describes the project, not a text. (Open question 1.)
- **Writing is deterministic.** The same document always serializes to the same bytes: no generated
  dates, no placeholders for empty fields, NFC text, LF line endings, fixed attribute order.
- **Parse ∘ serialize is the identity** for every file the app writes, proven over the IGNTP corpus.
- **SQLite is a cache of parsed TEI**, keyed by each file's SHA-256 and rebuildable at any time.

## Files

| Path                                              | Content                                                       |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `transcriptions/<ptid>.tei.xml`                   | Current transcription (was `.json` + derived `.tei.xml`)      |
| `collations/<id>.tei.xml`                         | Current collation (was `.json` + derived `.tei.xml`)          |
| `history/transcriptions/<ptid>/<version>.tei.xml` | Version snapshot, append-only except its version note         |
| `history/collations/<id>/<version>.tei.xml`       | Version snapshot                                              |
| `project.json`                                    | Project manifest; heads now point at `.tei.xml` (manifest v7) |
| `tombstones/…`                                    | Unchanged format; `cloud_path` points at `.tei.xml`           |
| `cbgm/…`                                          | Unchanged (already TEI input plus sidecars)                   |

## Hashes

- **File hash** = SHA-256 of the file's bytes. Used for cache validation and sync fingerprints.
- **Content hash** = SHA-256 of the serialized document _without_ its `<revisionDesc>` (save times and
  version notes). Used for dirty state, version integrity, manifest heads and collation witness source
  stamps. It is produced while serializing, so it costs one extra digest (~2–17 ms per file).
- This replaces today's canonical-JSON hash of SQLite rows and the `transcription_working_hashes` cache.
  Existing hashes are remapped once during migration (see Migration).

## Transcription file

The body is the existing transcription TEI, which already round-trips exactly for all 166 IGNTP Romans
files. The header and the sections around the body must change, because the app's path today rebuilds
the header from record fields, drops the imported `<teiHeader>`, stamps today's date and fills empty
fields with placeholders.

**Header:** the imported `<teiHeader>` tree is written back verbatim. Only the fields the app edits are
patched in place, and missing ones are added, never replaced by placeholders.

| Field                                                                      | TEI                                                                                                                                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| title                                                                      | `titleStmt/title`                                                                                                                                                    |
| transcriber                                                                | `titleStmt/respStmt[resp="Transcribed by"]/name`                                                                                                                     |
| siglum, repository, settlement                                             | `sourceDesc/msDesc/msIdentifier/idno`, `repository`, `settlement`                                                                                                    |
| language                                                                   | `profileDesc/langUsage/language/@ident`, kept equal to `text/@xml:lang`                                                                                              |
| description                                                                | `fileDesc/notesStmt/note[@type="description"]`                                                                                                                       |
| tags                                                                       | `profileDesc/textClass/keywords[@scheme="#apatosaurus-tags"]/term`                                                                                                   |
| owner, is_public                                                           | `publicationStmt/availability[@status="free"\|"restricted"]`, owner as `respStmt[resp="Owner"]`                                                                      |
| id, project transcription id, canonical id                                 | `publicationStmt/idno[@type="apatosaurus-transcription" \| "apatosaurus-project-transcription" \| "apatosaurus-canonical"]`                                          |
| origin (source project, transcription, version, content hash, captured at) | `sourceDesc/bibl[@type="apatosaurus-origin"]` with typed `idno`s and `date/@when`                                                                                    |
| based-on version                                                           | `publicationStmt/idno[@type="apatosaurus-based-on"]`                                                                                                                 |
| created, last saved, save author                                           | `revisionDesc/change[@type="created" \| "saved"]/@when`, `@who`                                                                                                      |
| content format                                                             | `encodingDesc/appInfo/application[@ident="apatosaurus"]/@version`                                                                                                    |
| reference editions used and their attributions                             | `listBibl/bibl[@type="referenceEdition"]` with `@xml:id` = edition id and the attribution text, written from the document and parsed back (no device catalog lookup) |

**IIIF** (today only inside the JSON):

| Data             | TEI                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manifest source  | `<facsimile xml:id="iiif-<id>" sameAs="<manifest url>">` with `<label>`, default canvas and image service as typed `<ptr>`                             |
| Page–canvas link | `<surface xml:id="canvas-<id>" sameAs="<canvas id>" n="<canvas label>">` with `<graphic url="<image service>">`; the page's `<pb facs="#canvas-<id>">` |
| Annotation       | `standOff/listAnnotation/annotation[@xml:id][@motivation]` with `@target` pointing at the surface or page, body as `<note>`                            |

The fetched manifest JSON (`metadata_json`, often a whole manifest) is a cache, not content: it moves to
SQLite and is re-fetched when missing. (Open question 3.)

Page ids are `pb/@xml:id`. A page without one gets a generated id on its first write, which keeps IIIF
links stable; this is the only change a first write makes to an imported IGNTP file.

**Versions** are full TEI snapshots in `history/`. The version's label, note, author, date and parent
are a `revisionDesc/change[@type="version"]` in the snapshot. Editing a note rewrites only that element.

## Collation file

Today's collation TEI export is lossy: it drops the alignment grid, settings, rules, witness provenance,
subreading links and most decision state, and it refuses to write unfinished collations. The canonical
file has two layers in one TEI document:

**1. Apparatus (body)**: the scholarly apparatus, readable by open-cbgm once the collation is complete.

- `listWit/witness[@xml:id][@n]`, `@n` the siglum. Corrector sigla without spaces (fixes the
  open-cbgm tokenizing problem in `cbgm-input.ts`).
- One `<app>` per variation unit with `<rdg n="<label>" wit type cert ana>`, `<witDetail>` for ambiguous
  and overlapped testimony, `<rdg n="zz" type="lac">` for non-attestation.
- `<note>` per unit: `<label>`, `<fs><f name="connectivity"><numeric/></f></fs>`,
  `<graph type="directed">` with `<node n="<label>">` and `<arc from="<label>" to="<label>"/>` using
  plain reading labels (the open-cbgm and Django form). Subreadings are an arc plus their type, as in
  the Django format.
- Readings carry persistent XML-safe ids (`rdg/@xml:id`). Today's proposed reading ids contain control
  characters and labels change on every relabel, so neither can be used.
- Reading types, tags and certainty use a `classDecl/taxonomy` and `interpGrp` in the header, so the file
  is self-describing without `project.json`.
- Unfinished states are written, not refused: untranscribed cells, unresolved attestations and
  undecided units are encoded explicitly. Export refusals remain only for publication-style exports.

**2. Working state (`<standOff type="apatosaurus-collation">`)**, everything the apparatus cannot carry:

| Data                                                                                                                                                                                           | TEI                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Witness provenance (transcription, kind, hand, source version or captured content hash, treatment, base, excluded)                                                                             | `<fs type="witness">` per witness, linked by `@corresp`                                                                                                                                                                                                                                                                |
| Witness token snapshots                                                                                                                                                                        | `<ab type="witness-tokens" corresp="#<witness>">` of `<w xml:id>`, `<gap>`, untranscribed notes                                                                                                                                                                                                                        |
| Alignment grid                                                                                                                                                                                 | `<seg type="alignment">`: one `<seg type="column">` per column, `<seg source>` per cell (no `<app>`, which open-cbgm would read as a unit) with `<choice><orig/><reg/></choice>` for regularized text, `@corresp` to tokens, `@ana` to rules; merged columns keep their split columns in a nested `<seg type="split">` |
| Declared units, witness order                                                                                                                                                                  | `<fs type="alignment">`                                                                                                                                                                                                                                                                                                |
| Regularization rules                                                                                                                                                                           | `encodingDesc/editorialDecl/normalization` with one `<fs type="rule" xml:id>` per rule                                                                                                                                                                                                                                 |
| Settings                                                                                                                                                                                       | `<fs type="collation-settings">`                                                                                                                                                                                                                                                                                       |
| Unit decisions not visible in the apparatus (overlap resolutions, spanning readings, manual testimony, unconfirmed and unresolved attestations, unclear sources, preserved and orphaned units) | `<fs type="unit-decisions" corresp="#<app>">`                                                                                                                                                                                                                                                                          |
| Workflow (phase, furthest phase, display mode, layout), import notes                                                                                                                           | `<fs type="workflow">`, `<note type="import">`                                                                                                                                                                                                                                                                         |

The CBGM input (`cbgm-input.ts`) stays a generated file, but it now reads the parsed collation instead of
the JSON, and the apparatus layer is made identical to it where they overlap.

## Reading and writing

- **Save:** document → TEI string and content hash → atomic file write → SQLite update (parsed content,
  verse slices, hands, hashes, listings) in the same worker request.
- **Load:** from SQLite when the stored file hash matches the file; otherwise parse the file and reindex.
- **Changes made outside the app** (Oxygen, a synced or location folder): the worker compares each file's
  size and last-modified time with the index when a project opens and before collating; a mismatch costs
  one SHA-256, and a changed hash re-parses that file (0.3–0.9 s per transcription).
- **Rebuild** (missing index, schema bump, corruption): parse every TEI file with the existing progress
  card. Measured parse cost suggests 2–3 min for 100 witnesses, similar to today's rebuild.

## Sync, conflicts, zip

- The `.tei.xml` is the synced primary. Remove the code that skips and regenerates TEI.
- Three-way compare stays byte-based. When both sides changed and the content hashes differ, create a
  conflict copy as today; equal content hashes take the remote file.
- Zip import parses and validates every TEI file instead of placing it unchecked.
- Deleting a transcription removes its TEI and history; tombstones name the TEI path.

## Migration

One-time, per project, with the progress card:

1. Convert each transcription JSON (and each history file) to TEI; record old → new content hash.
2. Convert each collation, rewriting witness source stamps through the hash map; convert its history.
3. Write `project.json` v7 with `.tei.xml` heads. Older app versions refuse v7, so they cannot sync a
   migrated project and overwrite it. (Open question 2.)
4. Verify by parsing every new file and comparing the result to the JSON-derived document; on any
   mismatch, stop and keep the JSON.
5. Move the JSON files to an unsynced `legacy/` folder for one release, then delete them. (Open question 5.)

## Phases

1. **Deterministic transcription TEI for the app path**: header preservation and patches, record fields,
   IIIF, reference editions, no dates or placeholders. A round-trip test over the corpus covering the
   app's metadata path (the current test calls `serializeTei` without metadata).
2. **Transcription storage switch**: TEI primary and history, SQLite built from TEI with file-hash
   validation, content hash from TEI, sync, zip, tombstones, manifest v7.
3. **Migration** of existing projects, transcriptions first.
4. **Collations**: two-layer TEI writer and parser with a round-trip test on fixtures, persistent reading
   ids, storage switch, migration.
5. **Remove** the JSON formats and their upgraders.

## Open questions

1. `project.json` stays JSON (project configuration, not a text)?
2. After migration, older app builds cannot open or sync a migrated project. Acceptable?
3. Fetched IIIF manifest JSON moves out of the file into a re-fetchable SQLite cache?
4. Are the header homes for owner, `is_public` and tags acceptable?
5. Keep the converted JSON in an unsynced `legacy/` folder for one release?
