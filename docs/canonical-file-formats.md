# Canonical File Formats

Canonical JSON documents evolve through pure migrate-on-read upgrades. Reads verify the original envelope hash, apply each version upgrade, validate the current shape and semantic integrity, and return a newly sealed in-memory document. Reading never rewrites the source file.

## Collation Version 2

Collation schema version 1 persisted the relational projection (`witnesses`, `tokens`, `variation_units`, and related arrays) plus a `collation_document_v1` artifact. Version 2 makes that semantic collation document the sole canonical `document` field and drops the rebuildable projection arrays and artifact wrapper.

The committed, working, and checkpoint collation formats evolve together:

- `apatosaurus.collation` validates its v1 revision hash before extracting `document`.
- `apatosaurus.working.collation` preserves draft metadata while extracting `document`.
- `apatosaurus.checkpoint.collation` validates the nested v1 payload hash before upgrading that payload.

Checked-in input and expected payload fixtures live in `app/src/lib/storage/formats/fixtures/`. Tests read every input through the public `readCanonicalDocument` API and compare the upgraded payload to its expected fixture.

## Project Transcription Version 2

Version 2 makes `transcriptions/<id>.json` the transcription's Current. Autosave writes it (and the derived TEI) directly; no transcription path writes `<id>.working.json` any more.

- `current_revision` is replaced by `based_on_checkpoint: { id, content_hash } | null`, the version Current was last named or restored from. Content may differ from that version, so v2 has no nested hash check.
- `draft: { saved_at, author_name }` carries the working format's draft metadata.
- The v1 upgrader validates the v1 revision hash, then maps `current_revision` to `based_on_checkpoint` and sets `draft.saved_at` from `updated_at`.
- Loading a transcription also folds a leftover `apatosaurus.working.transcription` file into the primary when its `draft.base_*` matches `based_on_checkpoint`. This is the one read that writes: it writes the new primary, then deletes the working file. A stale working file is left in place and reported by index rebuild.
- `apatosaurus.working.transcription` stays registered only so legacy files can be read and migrated.

## Collation Version 7

Version 7 applies the Project Transcription Version 2 change to collations: `collations/<id>.json` is the collation's Current, and autosave writes it (and the derived TEI) directly without touching `project.json`.

- `current_revision` is replaced by `based_on_checkpoint: { id, content_hash } | null`; `draft: { saved_at, author_name }` carries the working format's draft metadata.
- The v6 upgrader maps `current_revision` to `based_on_checkpoint` and sets `draft.saved_at` from `updated_at`; the v6 revision hash is checked after upgrade. Alpha v2 collations upgrade through the alpha converter and then the v6 upgrader.
- Loading folds a leftover `apatosaurus.working.collation` file into the primary when its `draft.base_*` matches `based_on_checkpoint`, writing the new primary before deleting the working file. Zip import folds both working formats the same way before placing files.
- `apatosaurus.working.collation` stays registered only so legacy files can be read and migrated. Checkpoint content is unchanged.

## Project Manifest Version 6

Version 6 preserves an optional trimmed, nonempty `description` on each `collation_settings.manualWitnesses` entry. The v5 upgrader is a no-op; the bump prevents older builds from dropping descriptions when saving settings.

## Collation Version 17

Version 17 adds `readingNotes?: Record<readingId, string>` to apparatus unit decisions. Notes are nonempty strings; malformed values quarantine the file. Notes describe readings without changing labels or CBGM input, and orphan when their reading disappears. The v16 upgrader is a no-op. Working and checkpoint formats preserve notes without a bump.

## Project Manifest Version 5

Version 5 permits project reading types with an explicitly empty suffix, as required by classic imports. The v4 upgrader is a no-op. Older settings parsers drop these types when saving, so older builds must reject this version.

## Collation Version 16

Version 16 adds optional document-level `importNotes`: an array of `{ id, unitId, detail }`, with a nullable unit ID. Notes retain classic-import differences until dismissed in Review. The v15 upgrader is a no-op; malformed notes quarantine the file. Working and checkpoint formats preserve notes without a bump.

## Collation Version 15

Version 15 adds optional `spanningReadingIds` and `overlapResolutions` to unit decisions. Spanning marks name readings; overlap resolutions map witness IDs to a reading or `overlapped`. The v14 upgrader is a no-op; malformed values quarantine the document. Working and checkpoint formats preserve both keys without a bump.

## Collation Version 14

Version 14 adds optional `setup.manualWitnessOverrides`, with stable manual witness IDs, exclusion flags and inherit/full/fragmentary treatment. The v13 upgrader is a no-op; malformed or duplicate overrides quarantine the document. Working and checkpoint formats preserve these keys without a bump.

## Collation Version 13

Version 13 adds optional `manualTestimony` and `authoredReadings` to unit decisions. Testimony maps stable project manual witness IDs to a reading, non-attestation or uncited state; authored readings carry their ID, text, omission flag and order, with null parent and type. Attachments and types use the existing decisions. Manual witness IDs never enter stored readings' witness lists. Malformed decisions quarantine the document.

The v12 upgrader is a no-op. Working and checkpoint formats preserve both keys through the shared parser and need no version bump.

## Project Manifest Version 4

Version 4 preserves `collation_settings.manualWitnesses`, with stable IDs, trimmed case-sensitive unique sigla, treatment and CBGM inclusion defaults. The v3 upgrader is a no-op; the bump prevents older builds from dropping the project list when saving settings.

## Collation Version 12

Version 12 adds optional `alignment.declaredUnits`, a list of `{ firstColumnId, lastColumnId }` declarations over contiguous column runs. Endpoints must be nonempty strings in forward column order; missing endpoints drop the declaration when hydrated, leaving its decisions orphaned. Single-column unit IDs remain `unit:<columnId>`; longer runs use `unit:<firstColumnId>..<lastColumnId>`.

The v11 upgrader is a no-op. Working and checkpoint formats preserve declarations through their semantic-document parser and need no version bump.

## Collation Version 11

Version 11 adds `readingTags?: Record<readingId, string[]>` to apparatus unit decisions. Tag ids are nonempty strings without duplicates; malformed values quarantine the file. Tags describe readings without changing labels, attachment or CBGM input, and orphan when their reading disappears.

The version 10 upgrader leaves the payload unchanged. Working collation version 4 and checkpoint version 5 preserve tags through the shared semantic document parser and need no version bump.

## Project Manifest Version 3

Version 3 preserves `collation_settings.readingTags?: { id: string, label: string }[]`. Labels are trimmed and unique without regard to case. The version 2 upgrader is a no-op; the bump prevents older builds from dropping the tag vocabulary when saving settings.

## Collation Version 10

Version 10 adds placement review decisions: `unconfirmedWitnessIds?: string[]` and `unresolvedAttestations?: { witnessId: string, candidateReadingIds: string[] }[]` on each apparatus unit. Unresolved attestations require at least two distinct candidate reading ids and hold their witness out of readings; unconfirmed marks do not change export or CBGM input.

The upgrade from version 9 leaves the payload unchanged. Malformed placement decisions quarantine the document. Working collation version 4 and checkpoint version 5 already preserve these decisions through the shared semantic document parser, so their versions stay unchanged.

## Collation Version 9

Version 9 adds ambiguous attestations to a variation unit's decisions: `document.apparatus.units[].decisions.ambiguousAttestations?: { id, witnessIds, targetReadingIds }[]`, cited `zw a/b`.

- The v8 upgrader is a no-op apart from the version number; v8 files never hold the new key.
- Reads validate each attestation: a string `id`, at least one witness id, and at least two distinct target reading ids. A malformed attestation quarantines the file rather than being dropped.
- `apatosaurus.working.collation` and `apatosaurus.checkpoint.collation` read the same semantic document without rejecting unknown decision keys, so their versions are unchanged.

## Transcription Checkpoint Version 2 and Collation Checkpoint Version 5

Both checkpoint formats gain the version's editable metadata. `commit_message` remains the version's note.

- `label: string` is the version's name. `metadata_updated_at: string` records the last label or note edit and decides last-write-wins when two devices edit the same version's note.
- Label, note and `metadata_updated_at` sit outside `payload`, so editing them never changes `payload` or `payload_content_hash`. History files stay append-only for content: the store rejects any rewrite that changes anything other than these fields and the envelope hash.
- The transcription v1 and collation v4 upgraders set `label` to `""` and `metadata_updated_at` to `created_at`. Index rebuild names unlabelled versions `Version N`, numbered by `created_at` per document; the label is written to the file the next time its note is edited.
- Collation checkpoint v4 keeps its payload hash check. Alpha v2 checkpoints upgrade through the alpha converter and then gain the same metadata.

## CBGM Analysis Version 2

Version 2 adds `settings.trivial_reading_types`, the reading types open-cbgm treats as agreeing with their source (`populate_db -z`). The v1 upgrader sets it to `[]`; the bump stops older builds from computing an analysis without its trivial types.

## CBGM Analysis Version 1

`cbgm/<id>.json` holds a CBGM analysis's metadata as `apatosaurus.cbgm-analysis` version 1, envelope-hashed like the other formats. There are no upgraders. Its sibling files are not canonical JSON:

- `cbgm/<id>.input.xml`: the frozen input TEI, written with the metadata when the analysis starts. It is authoritative, not derived.
- `cbgm/<id>.sqlite`: the binary cache, absent until coherence finishes.
- `cbgm/<id>.global-stemma.dot`: an imported native global stemma, optional.

The payload records `id`, `project_id`, a `name` unique within the project (trimmed, case-insensitive), `inputs_frozen_at`, `completed_at`, the analysis `settings` (snake_case), the frozen `collations` (`collation_id`, `content_hash`, `segment_name`), `witnesses`, `undecided_readings`, `input_tei_hash`, `cache_hash`, the `coherence` and `global_stemma` states, `computing_device` and `failure`. Both hashes are `sha256:` digests of the sibling file's bytes.

- Reads check that the file sits at `cbgm/<id>.json` for its own `id` and belongs to the reading project. A missing or invalid file never falls back to index rows.
- Settings, collations and input are never rewritten after creation. Cache and global-stemma bytes are written before the metadata that publishes them.
- An analysis has no versions. Deletion writes a `cbgm_analysis` tombstone that covers all four files, so stale sidecars cannot bring it back.
- When two devices change an analysis between syncs, sync resolves its files together, following the metadata: the device that syncs last wins, so the cache always matches `cache_hash`. Results are derived from the frozen inputs, so nothing is quarantined.
- Analyses are not listed in `project.json`; index rebuild reads every `cbgm/*.json` that has no tombstone.
