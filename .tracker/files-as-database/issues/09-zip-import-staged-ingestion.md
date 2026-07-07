# Issue 09: Zip Import with Staged Ingestion

Architecture reference: `../architecture.md` sections 3 (decision 7), 9 (invariant 9)

## What to build

A user can import a project zip (as produced by issue 08). Every file is validated through migrate-on-read before anything touches the live store: entries are staged into a temporary OPFS directory, validated all-or-nothing, then moved into place, and the project's index rows are rebuilt. If the project id already exists, the user chooses between "replace" (confirmation dialog naming which side is newer) and "import as copy" (new project id and slug, lineage fields noting provenance).

This issue also builds the **staged-ingestion primitive** that issues 10 and the sync layer will share — treat it as the deliverable, with zip import as its first consumer.

## Where to start

- `app/src/lib/client/store/opfs-store.ts`, `migrate-on-read.ts`, `quarantine.ts` — validation and quarantine codes already exist; ingestion composes them.
- `app/src/lib/client/db/repositories/index-rebuild.ts` — the rebuild report shape (restored counts, quarantined files, orphans); import reports reuse it.
- `app/src/lib/client/sync/project-restore.ts` — the old `importCloudProject()` transactional import; source of semantics, refactored fully in issue 10.
- Export from issue 08 defines the archive layout.

## Contract

- Staging lives at `apatosaurus/v1/staging/<nonce>/`. A failed or abandoned import leaves zero trace outside staging; stale staging directories are removed at startup.
- Validation before placement: every entry parses, passes envelope/shape/hash checks via migrate-on-read. Any failure aborts placement (all-or-nothing); the report says what failed and why.
- Path hygiene: entries must resolve inside the project folder; reject absolute paths and `..` segments; malformed archives fail cleanly.
- Import report reuses the issue 06 rebuild-report shape.
- "Import as copy" mints a new project id + slug and records provenance in lineage fields; "replace" is explicit and confirmed, never default.
- Round-trip guarantee (invariant 9): export -> wipe site data -> import restores the project byte-equivalent modulo local-only files. Automate against the memory/OPFS store; browsers where automation is impossible get a documented manual checklist step.

## Out of scope

- Import from a live directory handle (issue 10) — but design the ingestion entry point to take "a readable file tree", not "a zip", so issue 10 plugs in.
- Refactoring sync-pull onto the ingestion path (issue 10).
- Copy-with-lineage between existing projects (issue 11).

## Acceptance criteria

- [ ] Importing an issue-08 zip into an empty store restores the project; a round-trip test asserts byte equivalence modulo local-only files.
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
