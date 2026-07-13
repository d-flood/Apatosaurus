# Ticket 09: Zip Import with Staged Ingestion

Architecture reference: `../architecture.md` sections 3 (decision 7), 9 (invariant 9)

## What to build

A user can import a project zip (as produced by ticket 08). Every file is validated through migrate-on-read before anything touches the live store: entries are staged into a temporary OPFS directory, validated all-or-nothing, then moved into place, and the project's index rows are rebuilt. If the project id already exists, the user chooses between "replace" (confirmation dialog naming which side is newer) and "import as copy" (new project id and slug, lineage fields noting provenance).

This ticket also builds the **staged-ingestion primitive** that tickets 10 and the sync layer will share — treat it as the deliverable, with zip import as its first consumer.

## Where to start

- `app/src/lib/client/store/opfs-store.ts`, `migrate-on-read.ts`, `quarantine.ts` — validation and quarantine codes already exist; ingestion composes them.
- `app/src/lib/client/db/repositories/index-rebuild.ts` — the rebuild report shape (restored counts, quarantined files, orphans); import reports reuse it.
- `app/src/lib/client/sync/project-restore.ts` — the old `importCloudProject()` transactional import; source of semantics, refactored fully in ticket 10.
- Export from ticket 08 defines the archive layout.

## Contract

- Staging lives at `apatosaurus/v1/staging/<nonce>/`. A failed or abandoned import leaves zero trace outside staging; stale staging directories are removed at startup.
- Validation before placement: every entry parses, passes envelope/shape/hash checks via migrate-on-read. Any failure aborts placement (all-or-nothing); the report says what failed and why.
- Path hygiene: entries must resolve inside the project folder; reject absolute paths and `..` segments; malformed archives fail cleanly.
- Import report reuses the ticket 06 rebuild-report shape.
- "Import as copy" mints a new project id + slug and records provenance in lineage fields; "replace" is explicit and confirmed, never default.
- Round-trip guarantee (invariant 9): export -> wipe site data -> import restores the project byte-equivalent modulo local-only files. Automate against the memory/OPFS store; browsers where automation is impossible get a documented manual checklist step.

## Out of scope

- Import from a live directory handle (ticket 10) — but design the ingestion entry point to take "a readable file tree", not "a zip", so ticket 10 plugs in.
- Refactoring sync-pull onto the ingestion path (ticket 10).
- Copy-with-lineage between existing projects (ticket 11).

## Acceptance criteria

- [ ] Importing an ticket-08 zip into an empty store restores the project; a round-trip test asserts byte equivalence modulo local-only files.
- [ ] Same-id collision surfaces replace/copy choice; both paths tested.
- [ ] A zip with one corrupt file imports nothing outside staging; the report names the file and quarantine code.
- [ ] Path-traversal fixtures (absolute path, `..` entry) are rejected with no writes.
- [ ] Stale staging directories are cleaned at startup (test with a pre-seeded nonce dir).
- [ ] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/client/store src/lib/client/sync
bun run check && bun run test:unit -- --run
```

Success: focused suites include round-trip, collision, corruption, and traversal tests, all passing.

## Blocked by

- 08 (`08-zip-export.md`) — the archive format and round-trip test need export.

## Review Remediation (2026-07-13)

Ticket 09 is reopened because the readable-tree seam exists, but the user flow, validation, copy semantics, and all-or-nothing placement contract are incomplete.

### Required fixes

- Expose zip import through a DB/store-worker RPC and client API, then add a reachable file-picker/import action. Show validation reports and require explicit replace/copy choice naming local/imported timestamps; replace is never default.
- Split staging/validation from placement. The lower-level result contains validated staged entries and a report but performs no collision decision, deletion, conflict resolution, or rebuild. Ticket 10 and sync consume this seam with their own policies.
- Define an allowlist/path-to-format registry for manifest, both primaries, both working formats, both checkpoint trees, canonical tombstones, and TEI. Reject unknown files unless explicitly tolerated. Match working collations before committed collations.
- Run envelope migrate-on-read plus format-specific semantic checks before placement: current revision hashes, checkpoint payload hashes/entity ids, manifest heads/paths/project ids, entity identities, and tombstone identity.
- Validate path segments; reject absolute/backslash/empty/`.`/`..` paths, duplicate normalized paths, and multiple project roots in a single-project import.
- Make placement recoverable and manifest-last. Do not delete the live project before replacement is durable. Preserve rollback state or use an atomic/recoverable swap; move/write/rebuild failure restores the exact old project and leaves no partial live replacement.
- Complete import-as-copy rewriting: manifest id/name/slug, collation `project_id`, embedded document project metadata, working files, project-scoped checkpoint data, tombstones, and other project ids. Record provenance, revalidate rewritten files, regenerate TEI, and document intentionally stable entity/revision ids.
- Run stale staging cleanup during startup. Do not delete an active import from another live session; use ownership/age data to identify stale work.
- Support ticket 08's all-project archive or coordinate a documented switch to separate project zips.

### Required tests

- Add UI/RPC coverage for empty-store import and explicit collisions.
- Round-trip a complete project with both entity/working/history types, tombstones, TEI, IIIF, and lineage; assert byte equivalence modulo documented rewrites/exclusions.
- Reject corrupt collation history, semantic hash mismatch, unknown JSON, duplicate normalized paths, and all traversal forms before live writes.
- Inject every placement move/write, manifest, and rebuild failure; assert the previous project is byte-identical and no partial replacement is live.
- Validate every import-as-copy rewrite and rebuild twice to prove stable identity/lineage.
- Preseed stale and active staging directories; startup removes only stale directories.
- Restore an all-project export with independent create/replace/copy outcomes.

Completion gate: users can import ticket 08 backups through the UI, every accepted canonical file is fully validated before live writes, and every failure preserves the exact pre-import store.
