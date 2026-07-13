# Ticket 02: Document Store Foundation

Blocked by: None - can start immediately
Architecture reference: `../architecture.md` sections 4, 5, 6 (atomic writes), 9

## Goal

Build the OPFS document store that everything else stands on: the canonical directory layout, atomic file writes, the document envelope, and the migrate-on-read framework. This phase is pure infrastructure with exhaustive unit tests; no feature code moves onto it yet.

## Scope

Create a new module, suggested location `app/src/lib/client/store/`:

1. `opfs-store.ts` - low-level file operations against `navigator.storage.getDirectory()`:
   - `readTextFile(path)`, `writeTextFileAtomic(path, content)`, `deleteFile(path)`, `listDirectory(path)`, `ensureDirectory(path)`, `moveFile(from, to)`
   - Atomic write: write `<name>.tmp-<nonce>` via sync access handle in a worker context, flush, close, then `FileSystemFileHandle.move()` over the target; fallback (feature-detect) to write-temp -> read-back hash verify -> copy -> delete-temp.
   - All paths relative to the app root `apatosaurus/v1/` (single constant).
2. `layout.ts` - typed path builders for the canonical layout (project folder, transcription primary/working/tei, collation primary/working/tei, history, tombstones, `app/`, `index/`). No string-built paths anywhere else.
3. `envelope.ts` - document envelope types and helpers:
   - `format`, `schema_version`, `content_hash` fields
   - `sealDocument(format, version, payload)` computes `content_hash` via existing `canonical-json.ts`
   - `openEnvelope(raw)` parses and validates the envelope shape only
4. `migrate-on-read.ts` - upgrade registry:
   - `registerFormat(formatId, currentVersion, upgraders: Array<(doc) => doc>)`
   - `readDocument(formatId, raw)`: parse -> envelope validate -> upgrade chain -> shape validate (validator supplied per format) -> hash verify -> return `{ document, upgraded: boolean }`
   - Quarantine result type reusing the existing codes: `invalid_json`, `invalid_schema_version`, `invalid_shape`, `hash_mismatch`
   - Reads never write; callers persist upgraded documents only on their next save.
5. `quarantine.ts` - move-aside behavior: a file that fails `readDocument` is recorded (path, code, timestamp) in an in-memory report the caller surfaces; the file itself is never modified, deleted, or overwritten by the reader.
6. Fixture-based tests:
   - Atomic write survives simulated interruption (temp file present, target intact).
   - Envelope round-trip and hash verification.
   - A synthetic format with v1 -> v2 -> v3 upgraders and fixtures for each hop, proving chained upgrades and that v3 files pass through untouched.
   - Quarantine on each failure code.

## Non-Goals

- No real document formats yet (Phase 3).
- No SQLite involvement.
- No sync or provider interaction; this store is OPFS-local.

## Design Notes

- OPFS sync access handles require a worker. Decide and document whether the store runs inside the existing DB worker (extend `db.worker.ts` RPC) or a new dedicated store worker. Recommendation: a new `store.worker.ts` with the same promise-queue RPC pattern as `db.worker.ts`, so the index worker and store worker fail independently. Record the decision here.
- Unit tests run under `@vitest/browser` (browser mode) where OPFS is available; keep a thin FS abstraction so node tests can use an in-memory implementation.
- `move()` support must be feature-detected at runtime, not assumed; Safari's OPFS lacks it in some versions. The fallback path needs its own test.
- Directory listing must tolerate unknown files (future formats, user-dropped files in synced folders) by ignoring, not erroring.

## Checklist

- [x] `opfs-store.ts` with atomic writes and fallback, tested
- [x] `layout.ts` path builders, tested
- [x] `envelope.ts` seal/open with canonical-json hashing, tested
- [x] `migrate-on-read.ts` registry with chained-upgrade fixtures, tested
- [x] Quarantine behavior tested for all four codes
- [x] Worker placement decided and documented in Notes
- [x] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

The store module is fully tested and importable, with zero feature-code consumers. The invariants "reads never mutate files" and "failed reads quarantine, never destroy" are asserted by tests.

## Verification

```bash
cd app
bun run test:unit -- --run src/lib/client/store
bun run check
```

## Verification Results

| Date | Command | Result |
| --- | --- | --- |
| 2026-07-03 | `bun run test:unit -- --run src/lib/client/store` | Passed: 4 files, 13 tests. |
| 2026-07-03 | `bun run db:generate && bun run db:check && bun run check` | Passed. |
| 2026-07-03 | `bun run test:unit -- --run` | Passed after adding explicit 30s timeouts to two long-running Chromium editor specs exposed by full-suite load: 60 files, 336 tests. |
| 2026-07-03 | `bun run check` | Passed after the test-timeout edits. |
| 2026-07-13 | `bun run test:unit -- --run src/lib/client/store` | Passed: 8 files, 33 tests, including real Chromium OPFS coverage. |
| 2026-07-13 | `bun run db:generate && bun run db:check && bun run check && bun run test:unit -- --run` | Passed: type generation/check, Svelte check, 80 files and 441 tests. |

## Notes

| Date | Note |
| --- | --- |
| 2026-07-03 | Phase completed. Added `app/src/lib/client/store/` with canonical layout path builders, envelope sealing/opening, migrate-on-read registry, in-memory quarantine reporting, OPFS text operations with atomic temp writes and move-unavailable fallback, and fixture-backed unit tests. No feature code consumes the store yet. |
| 2026-07-03 | Worker placement decision: future feature consumers should call the store through a dedicated `store.worker.ts`, not the DB worker. This phase keeps `opfs-store.ts` worker-safe and importable; wiring the worker RPC can happen when write paths move onto the store. |
| 2026-07-03 | Migrate-on-read verifies the source file's existing `content_hash` before running upgraders, then returns an in-memory document resealed at the current version. Reads still never write upgraded files. |
| 2026-07-03 | Full unit verification exposed existing browser-suite load sensitivity in two large transcription editor specs. Added explicit 30s per-test timeouts to those long workflows, then reran the full unit suite successfully. |
| 2026-07-13 | Review remediation completed. Atomic fallback replacement now commits through `FileSystemWritableFileStream.close()` instead of truncating the live target, unsupported `move()` operations fall back without swallowing permission/I/O errors, and interrupted replacement preserves the old target and verified temp candidate. Real Chromium OPFS tests cover native move, missing/unsupported move, aborted replacement, and retry recovery. |
| 2026-07-13 | Worker placement contract resolved with an equivalent single-writer boundary rather than a dedicated RPC worker: every public canonical mutation in `opfs-store.ts` runs under the shared `apatosaurus:document-store-writer` Web Lock across UI and worker contexts, with a serialized in-realm queue where Web Locks are unavailable. Production code has no direct backend writes outside this boundary. |
| 2026-07-13 | Project-relative paths now come from `layout.ts`; manifest, cloud sync, and zip paths share those helpers, including canonical entity-scoped tombstone names. Normal transcription and collation read failures record structured path/code/message entries in the production quarantine report (or a caller-supplied sink) before fallback, with tests for all four validation codes and source immutability. |

## Review Remediation (2026-07-13)

Ticket 02 is reopened because production consumers now depend on guarantees that the foundation does not fully provide.

### Required fixes

- Make the no-`move()` replacement path crash-safe. The current fallback verifies the temporary file and then truncates/writes the live target directly. Use a replacement whose changes become visible only after successful close, or retain enough verified old/temp state for startup/read recovery. A failed fallback must never leave an empty or partial canonical target as the only readable version.
- Treat an operationally unsupported `FileSystemFileHandle.move()` as a fallback condition, not only a missing `move` function. Preserve genuine permission and I/O errors.
- Add real browser OPFS coverage for replacing an existing target with `move()`, no-`move()` fallback, interruption while copying the target, and temporary-file recovery. Memory-backend behavior is not sufficient evidence.
- Finish the worker-placement contract from the notes. Canonical feature writes must execute through one serialized store worker or an equivalently documented single-writer boundary.
- Replace remaining canonical path literals in manifest/cloud adapters with `layout.ts` helpers that can return project-relative paths.
- Define one production quarantine sink for normal file reads. Callers may choose presentation, but every failed canonical read must produce a structured path/code/message record rather than only `console.warn` and fallback.

### Required tests

- Inject failure after live-target replacement begins and prove the previous valid document or a verified recovery candidate remains available.
- Exercise a browser backend where `move` is missing or rejects as unsupported.
- Assert normal transcription/collation read failures record all four quarantine codes and never mutate source files.
- Add canonical-path consistency coverage for manifest, sync, export, and store layout paths.

Completion gate: atomic replacement holds for both browser paths, canonical writers share a serialization boundary, and failed canonical reads can always be surfaced as structured quarantine data.
