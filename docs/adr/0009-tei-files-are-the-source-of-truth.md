# TEI files are the source of truth for transcriptions and collations

Status: accepted

Each transcription and each collation is stored as exactly one TEI P5 file, and that file is its only canonical copy. Everything the app keeps about a document, from header fields and IIIF links to alignment and editorial decisions, is encoded in that file as TEI, with no embedded JSON. Scholars treat TEI as the authoritative form of their work: IGNTP transcriptions arrive as TEI, colleagues edit them in Oxygen, open-cbgm reads them, and an archive must stay readable outside Apatosaurus. The SQLite index is a cache of parsed TEI, and `project.json` stays JSON because it holds project configuration, not documents.

## Considered Options

- **JSON canonical, TEI derived on save** — Rejected: the derived TEI dropped imported headers and most collation state, so the file scholars archive was not the complete document, and edits made to it outside the app were overwritten.
- **TEI with embedded JSON for app-only state** — Rejected: other tools cannot read or edit that state, so the TEI would again not be the whole document.

## Consequences

- Supersedes ADR 0003's consequence that "file formats stay plain JSON". ADR 0003's decision, editing notices and conflict copies instead of locks or merging, stands.
- Serialization is deterministic: no generated dates, no placeholder values, NFC text, LF line endings and fixed attribute order, so the same document always writes the same bytes.
- A content hash taken without `<revisionDesc>` lets a save that changes only the save time count as no change.
- App-owned header fields are patched into an imported `<teiHeader>`, which is otherwise written back verbatim, and the output stays valid against the IGNTP schema.
