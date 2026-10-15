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

## CBGM Analysis Version 1

`cbgm/<id>.json` holds a CBGM analysis's metadata as `apatosaurus.cbgm-analysis` version 1, envelope-hashed like the other formats. There are no upgraders. Its sibling files are not canonical JSON:

- `cbgm/<id>.input.xml`: the frozen input TEI, written with the metadata when the analysis starts. It is authoritative, not derived.
- `cbgm/<id>.sqlite`: the binary cache, absent until coherence finishes.
- `cbgm/<id>.global-stemma.dot`: an imported native global stemma, optional.

The payload records `id`, `project_id`, a `name` unique within the project (trimmed, case-insensitive), `inputs_frozen_at`, `completed_at`, the analysis `settings` (snake_case), the frozen `collations` (`collation_id`, `content_hash`, `segment_name`), `witnesses`, `undecided_readings`, `input_tei_hash`, `cache_hash`, the `coherence` and `global_stemma` states, `computing_device` and `failure`. Both hashes are `sha256:` digests of the sibling file's bytes.

- Reads check that the file sits at `cbgm/<id>.json` for its own `id` and belongs to the reading project. A missing or invalid file never falls back to index rows.
- Settings, collations and input are never rewritten after creation. Cache and global-stemma bytes are written before the metadata that publishes them.
- An analysis has no versions. Deletion writes a `cbgm_analysis` tombstone that covers all four files, so stale sidecars cannot bring it back.
- Analyses are not listed in `project.json`; index rebuild reads every `cbgm/*.json` that has no tombstone.
