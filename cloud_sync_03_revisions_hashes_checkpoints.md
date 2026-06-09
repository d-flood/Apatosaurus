# Session 03: Revisions, Hashes, and Checkpoints

## Goal

Implement deterministic app revision metadata, content hashing, and checkpoint creation for transcriptions and collations.

The key invariant is that local SQLite rows are working state, while `current_revision_id` and `current_content_hash` describe the last committed app revision.

## Dependencies

- [Session 01](cloud_sync_01_initial_schema.md)
- [Session 02](cloud_sync_02_project_snapshots.md)

## Concepts

- Cloud revision: provider-level file revision such as Dropbox `rev` or Google Drive ETag/generation. Used only for sync conflict detection.
- App revision: Apatosaurus checkpoint/commit ID. This is the user-facing version.
- Content hash: SHA-256 hash of the canonicalized semantic payload. This verifies that serialized content matches the app revision it claims to contain.

## Hash Contract

The initial hash contract is part of `schema_version = 1`. If these rules change later, the serialized schema version must change too.

1. Algorithm and encoding: `sha256:` followed by the lowercase 64-character hex SHA-256 digest of the UTF-8 bytes of canonical JSON.
2. Hash input: hash the semantic revision payload, not the cloud wrapper file. Exclude cloud metadata, provider revisions, sync metadata, `schema_version`, `current_revision`, checkpoint envelope fields, provenance/origin fields, and existing hash fields.
3. Transcription payload: include stable project snapshot identity and user-authored transcription state, including `project_transcription_id`, transcription `id`, `format`, `title`, `siglum`, `description`, `content_json`, `tags`, `transcriber`, `repository`, `settlement`, `language`, IIIF manifest sources, page canvas links, and canvas annotations. Exclude bookkeeping `created_at` and `updated_at` unless they become user-authored metadata.
4. Collation payload: include `id`, `project_id`, `title`, `verse_identifier`, `status`, `group_path`, `notes`, `sort_key`, witnesses, tokens, variation units, readings, reading witnesses, and artifacts. Witnesses must include `project_transcription_id`, `transcription_id`, `source_revision_id`, and `source_content_hash`.
5. Object ordering: sort object keys lexicographically by Unicode code point. Arrays keep semantic order. Arrays loaded from SQL must be sorted before hashing when return order is incidental.
6. SQL ordering: manifests by `id`; page links by `page_order`, `canvas_order`, then `id`; annotations by `annotation_id`; witnesses by `position` then `id`; tokens by `witness_id` then `token_index`; variation units by `start_index`, `end_index`, then `id`; readings by `reading_order` then `id`; reading witnesses by `reading_id` then `witness_id`.
7. Value normalization: normalize strings to NFC and line endings to `\n`. JSON booleans serialize as booleans, not SQLite `0` or `1`. Numbers must be finite JSON numbers. Identifiers and timestamps remain strings.
8. Serialization: emit canonical JSON with no insignificant whitespace. Preserve `null`. Reject `undefined`, functions, `NaN`, and `Infinity`.
9. Verification: the primary entity file and referenced checkpoint file must produce the same content hash for the same committed revision.

## Implementation Scope

- Add canonical JSON utilities.
- Add SHA-256 hash helpers for transcription and collation semantic payloads.
- Add committed checkpoint creation for transcriptions and collations.
- Add local-only autosave checkpoint creation with `is_committed = 0` if recovery checkpoints are already useful in the current UI.
- Add dirty-state helpers that compare the current working payload hash with `current_content_hash`.
- Advance `current_revision_id` and `current_content_hash` only when a formal commit is created.
- Do not upload or serialize local-only autosave checkpoints for cloud sync.

## Suggested APIs

Exact names can change to match the codebase, but keep the responsibilities separate.

```ts
canonicalJson(value: unknown): string;
hashCanonicalPayload(value: unknown): Promise<string>;
buildTranscriptionHashPayload(input: ProjectTranscriptionSnapshot): unknown;
buildCollationHashPayload(input: SerializedCollation): unknown;
createCommittedTranscriptionCheckpoint(input: CommitTranscriptionInput): Promise<Checkpoint>;
createCommittedCollationCheckpoint(input: CommitCollationInput): Promise<Checkpoint>;
isTranscriptionDirty(projectTranscriptionId: string): Promise<boolean>;
isCollationDirty(collationId: string): Promise<boolean>;
```

## Working State Rules

- A local entity is dirty when the canonical hash of the current working payload differs from `current_content_hash`, or when no committed revision exists.
- Remote sync validation always uses committed payloads and checkpoints, not dirty local working rows.
- When a user commits, hash the current local working payload, create a committed checkpoint, and advance the entity head to that checkpoint.
- When a valid remote committed head is downloaded later, replace the local working row automatically only if there are no uncommitted local changes.

## Acceptance Criteria

- Hashing is stable across object key order, SQL row order, whitespace, line endings, boolean normalization, and repeated serialize/parse cycles.
- Creating a commit inserts a committed checkpoint and advances the primary entity's current revision/hash.
- Dirty local working rows are not treated as corruption.
- Local autosave checkpoints, if implemented, remain `is_committed = 0` and are excluded from cloud sync payloads.

## Verification

Run from `app/`:

```bash
bun run check
bun run test:unit -- --run
```

Add focused tests for hash stability, dirty-state detection, and checkpoint creation.
