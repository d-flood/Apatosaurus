# Canonical File Formats

Canonical JSON documents evolve through pure migrate-on-read upgrades. Reads verify the original envelope hash, apply each version upgrade, validate the current shape and semantic integrity, and return a newly sealed in-memory document. Reading never rewrites the source file.

## Collation Version 2

Collation schema version 1 persisted the relational projection (`witnesses`, `tokens`, `variation_units`, and related arrays) plus a `collation_document_v1` artifact. Version 2 makes that semantic collation document the sole canonical `document` field and drops the rebuildable projection arrays and artifact wrapper.

The committed, working, and checkpoint collation formats evolve together:

- `apatosaurus.collation` validates its v1 revision hash before extracting `document`.
- `apatosaurus.working.collation` preserves draft metadata while extracting `document`.
- `apatosaurus.checkpoint.collation` validates the nested v1 payload hash before upgrading that payload.

Checked-in input and expected payload fixtures live in `app/src/lib/client/store/formats/fixtures/`. Tests read every input through the public `readCanonicalDocument` API and compare the upgraded payload to its expected fixture.
