# Apatosaurus Architecture: Files Are the Database

Status: Accepted
Date: 2026-07-03
Supersedes: `cloud_sync_*.md` (root, deleted), `plans/00-project-only-transcriptions-overview.md` and phases 01-10 (deleted)

This document is the reference architecture for the storage inversion. Phase documents in this directory describe how to implement it in session-sized steps. Read this document before starting any phase.

## 1. Problem Statement

Apatosaurus is a local-first PWA for creating digital critical apparatuses and editions (transcription + collation). An audit (2026-07-03) found:

- SQLite in OPFS (`wa-sqlite` + `OPFSCoopSyncVFS`) is the source of truth. A botched migration of the OPFS database file is unrecoverable. This makes every schema change a data-loss risk and is incompatible with the expected rate of user-driven churn.
- The same data persists redundantly in up to five places (working rows, derived index tables, checkpoint payloads, artifact payloads, cloud files), with lossy merge steps between them. The known editor bugs (cursor jumps, inconsistent collation rules) are symptoms of these duplicated representations.
- The cloud sync layer already serializes projects as self-contained folders of hash-validated JSON files with tombstones, conflict copies, and quarantine, plus a full `importCloudProject()` restore path. This file layer is architecturally sounder than the database it backs up.
- There is no funding for a hosted database or server. Users must own their data.

## 2. Core Decision

Invert the persistence hierarchy.

> A project is a folder of versioned document files. SQLite is a disposable, rebuildable index.

- The canonical persistence layer is a set of plain files in OPFS, organized per project, in the (promoted) cloud file formats.
- The SQLite database holds only derived data: listings, verse index, collation projections, search. It is stamped with an index schema version. Schema changes do not migrate the database; they drop it and rebuild from files.
- Deleting the SQLite database must never lose user data. This is the invariant every phase protects.

## 3. Product Decisions (Consolidated)

These carry over from the superseded plans plus the 2026-07-03 audit decisions:

1. Transcriptions and collations are always owned by a project. There is no user-visible global library.
2. Every user gets an automatically created `Default` project. Creation and import flows assign to a project, defaulting to `Default`.
3. Sharing between projects is copy-with-lineage (duplication is accepted). `origin_*` provenance is preserved and surfaced; refresh-from-source is explicit and user-confirmed. No live sharing, no automatic merge.
4. Committed state is the sync boundary. Working (uncommitted) state is local-only.
5. Direct cloud provider integrations (Dropbox, Google Drive OAuth APIs) are removed from scope. The supported sync target is a user-chosen local folder via the File System Access API (Chromium). Users who want cloud replication point that folder at a directory managed by their own Dropbox/Drive/OneDrive desktop client (the Obsidian/Zotero model).
6. The `StorageProvider` interface remains pluggable. Future targets (Tauri native FS, institutional WebDAV/HTTP file store, restored OAuth providers) are new provider implementations, not new sync semantics.
7. Zip export/import of a whole project is a first-class, all-browsers feature. It is the backup story for non-Chromium users and the panic button for everyone.
8. Recommended setup messaging: Chromium-based browser, install the PWA, enable persistent storage, choose a sync folder. Safari/Firefox get the full app minus folder sync.
9. Greenfield: no migration or backfill compatibility for existing browser databases. File formats start at their declared `schema_version` and evolve via migrate-on-read from then on.
10. Tauri distribution is deferred. The architecture must not preclude it (static build + provider seam keep it a small wrapper project later).

## 4. Canonical File Layout

All paths are inside OPFS (`navigator.storage.getDirectory()`), under a single app root:

```
apatosaurus/
  v1/
    projects/
      <project-slug>/
        project.json                                  # manifest: heads, hashes, settings
        transcriptions/
          <transcription-id>.json                     # committed canonical document
          <transcription-id>.working.json             # local-only working copy (never synced)
          <transcription-id>.tei.xml                  # derived TEI export (regenerated on commit)
        collations/
          <collation-id>.json
          <collation-id>.working.json                 # local-only
          <collation-id>.tei.xml                      # derived TEI apparatus (regenerated on commit)
        history/
          transcriptions/<transcription-id>/<checkpoint-id>.json   # append-only
          collations/<collation-id>/<checkpoint-id>.json           # append-only
        tombstones/
          <entity-type>--<entity-id>.json
    app/
      settings.json                                   # local-only app state
      sync-targets.json                               # per-project sync folder config (handles ref IndexedDB)
    index/
      apatosaurus-index-v<N>.db                       # SQLite cache; disposable
```

Rules:

- `project-slug` is immutable, derived from the initial project name plus a unique suffix. Renaming a project does not rename its folder (carried over from the superseded plan).
- `*.working.json` and everything under `app/` are local-only and excluded from sync and zip export by default (zip export may optionally include working state, clearly labeled).
- Derived `*.tei.xml` files sync and export. They are regenerated on every commit; sync conflicts on them are resolved by regeneration, never by merge.
- `history/` is append-only. Checkpoint files are never rewritten or deleted by normal operation.
- The index database is named by its schema version. Bumping `INDEX_SCHEMA_VERSION` is the only migration mechanism: on open, if the versioned file is absent, rebuild from files and delete older index files.

The sync mirror in the user's chosen folder is byte-identical to the project folder minus local-only files.

## 5. Document Envelope and Schema Evolution

Every canonical file is JSON with a common envelope:

```json
{
  "format": "apatosaurus.project-transcription",
  "schema_version": 1,
  "content_hash": "<canonical-json hash of payload>",
  "...payload fields": "..."
}
```

Format identifiers (initial set):

| Format id | Content |
| --- | --- |
| `apatosaurus.project-manifest` | project metadata, collation settings, entity heads (id, revision, hash), tombstone heads |
| `apatosaurus.project-transcription` | committed transcription: metadata, `normalized_ast_v3` content, IIIF sources/links/annotations, lineage (`origin_*`), current revision |
| `apatosaurus.collation` | committed collation: `collation_document_v1` payload, witnesses with pinned source revision/hash, current revision |
| `apatosaurus.checkpoint.transcription` | append-only committed snapshot with parent pointer, message, author |
| `apatosaurus.checkpoint.collation` | same for collations |
| `apatosaurus.tombstone` | deletion record |
| `apatosaurus.working.transcription` | local-only working state (autosave target) |
| `apatosaurus.working.collation` | local-only working state |

Schema evolution is migrate-on-read:

- A registry maps each format id to an ordered list of pure upgrade functions (`v1 -> v2`, `v2 -> v3`, ...).
- Read path: parse -> validate envelope -> upgrade to current version -> validate shape -> verify `content_hash` -> return.
- Files are only rewritten at the new version when saved. Reading never mutates files.
- Every upgrade function ships with fixture files for its input and expected output. The existing quarantine codes (`invalid_json`, `invalid_schema_version`, `invalid_shape`, `hash_mismatch`) carry over: unreadable files are quarantined and surfaced, never silently dropped or overwritten.

Intermediate representations (ProseMirror JSON in the editor, alignment snapshots, regularized token maps, SQLite projections) are legitimate but must be in-memory or rebuildable. Exactly one persisted canonical representation exists per entity: its committed file (plus its working file for uncommitted state).

TEI is a derived interchange/archival format, not the source of truth. Rationale: canonical-JSON hashing already operates on the AST; making TEI canonical would make parser round-trip fidelity a correctness requirement for every save, and XML normalization churn would create spurious diffs. The always-fresh `.tei.xml` sibling gives users legibility, archival value, and an exit if the app dies.

## 6. Write Paths

### Autosave (working state)

1. Editor/collation state debounces (existing 1000ms / 800ms).
2. Serialize working document; atomic-write `<id>.working.json`.
3. Update index rows needed for live UI (verse index, projections).
4. Single-writer rule: the in-memory canonical document is replaced only after the file write succeeds. No mutation of the canonical document during scheduling (root cause of editor state drift).

### Commit

1. Flush pending working save.
2. Build committed document; compute canonical-JSON `content_hash`.
3. Write history checkpoint file (append-only).
4. Atomic-write committed primary file `<id>.json`.
5. Best-effort write derived `<id>.tei.xml` (failure logs and surfaces; never blocks the commit).
6. Update `project.json` manifest heads (manifest is always written last).
7. Update index rows.
8. If a sync target is configured, queue a sync pass.

Ordering guarantee: entity files before manifest. A crash mid-commit leaves an old manifest pointing at valid files plus possibly-orphaned new files; orphans are detected on rebuild and surfaced as recoverable, never deleted automatically.

### Atomic writes

- OPFS: write to `<name>.tmp-<nonce>` via sync access handle, flush, close, then `FileSystemFileHandle.move()` over the target. Where `move()` is unavailable, fall back to write-temp -> read-back-verify-hash -> copy -> delete-temp.
- Local folder (File System Access API): `createWritable()` writes to a temp file and commits on `close()` per spec; rely on that, verify with a read-back fingerprint on first use of a folder.

## 7. The Index (SQLite)

- Keeps: project/transcription/collation listing metadata, `transcription_verse_index`, collation projection tables, checkpoint listings for history UI, search support.
- Loses: canonical content, checkpoint payload blobs as source of truth, OAuth tables (`cloud_connections`, `cloud_project_folders`, `cloud_sync_metadata` are removed or rebuilt as local sync-state cache derived from files + `sync-targets.json`).
- `INDEX_SCHEMA_VERSION` constant stamps the filename. On startup: open versioned file if present; otherwise rebuild from files, then delete stale index files.
- Rebuild is a first-class operation exposed in the UI as "Repair database" and used by tests: scan `projects/`, parse each file through migrate-on-read, repopulate all tables, report quarantined/orphaned files.
- Nothing irreplaceable may live in the index. Settings live in `app/settings.json`; directory handles live in IndexedDB (structured-cloneable) referenced from `app/sync-targets.json`.

## 8. Sync Model

Sync is file replication between the OPFS project folder and one provider target per project.

- Providers kept: `local-folder-provider` (primary), `mock-provider` (tests). Removed: Dropbox, Google Drive, OAuth/PKCE/token code.
- Scope: committed primaries, history, tombstones, manifest, derived TEI. Never working files or `app/`.
- Change detection: per-file fingerprints (size + mtime + cached hash) recorded at last sync. Before overwriting either side, compare against the recorded fingerprint; divergence on both sides produces a conflict copy (existing `conflicts.ts` semantics: preserve both, never merge).
- Deletions propagate via tombstone files; a tombstone removes the primary but never the history directory.
- Polling stays modest (existing 30-60s backoff poller) plus sync-on-commit and sync-on-focus. Consumer cloud clients (Dropbox/Drive desktop) add their own latency; that is accepted.
- Permission lifecycle: installed-PWA persistent permissions where available (Chromium 122+); otherwise a visible "reconnect folder" state with one-click re-grant. Sync silently pausing is not acceptable; the status must be visible.
- Multi-user assumption: collaborators do not edit the same entity concurrently. Conflict copies are the safety net, not a merge system.

## 9. Data-Safety Invariants

Every phase must preserve these; the verification phase asserts them:

1. Deleting the index database loses no user data (rebuild restores full state).
2. No canonical file is ever overwritten except by atomic write of a newer revision of the same entity, or restored tombstone processing.
3. History files are append-only.
4. Reads never mutate files; migrate-on-read upgrades persist only on save.
5. Unparseable files are quarantined and surfaced, never deleted or overwritten.
6. A crash at any point leaves the project folder readable (old manifest + valid entity files).
7. Working state survives crash via its own atomically-written file.
8. `navigator.storage.persist()` is requested; persistence status is visible to the user.
9. Zip export produces a folder-equivalent archive that zip import fully restores on any supported browser.

## 10. Out of Scope (Deferred, Not Precluded)

- Tauri desktop distribution (becomes a wrapper + native FS provider later).
- Institutional server provider (WebDAV or dumb HTTP file store against the provider interface).
- Restored direct Dropbox/Drive API providers.
- Any realtime/multiplayer collaboration or automatic merging.
- CRDTs. Rejected deliberately: the committed-file + conflict-copy model matches committee workflows and consumer-storage latency; CRDT complexity buys nothing here.

## 11. Phase Map

| Phase | Document | Theme |
| --- | --- | --- |
| 01 | `01-remove-cloud-providers.md` | Scope-down: delete OAuth providers, keep provider seam |
| 02 | `02-document-store-foundation.md` | OPFS document store, atomic writes, envelope, migrate-on-read |
| 03 | `03-canonical-file-formats.md` | Promote cloud formats to canonical; fold IIIF in; TEI derivation |
| 04 | `04-project-only-data-model.md` | Project-only ownership, Default project, slugs, index-only SQLite schema |
| 05 | `05-write-path-inversion.md` | Autosave/commit write files first; single-writer rule |
| 06 | `06-index-rebuild-and-repair.md` | Versioned index, rebuild-from-files, Repair database |
| 07 | `07-local-folder-sync.md` | Folder mirror sync, fingerprints, conflicts, permission UX |
| 08 | `08-import-export.md` | Zip export/import, import-from-folder, copy-with-lineage |
| 09 | `09-durability-and-onboarding.md` | storage.persist(), project-first UI, recommended-setup messaging |
| 10 | `10-collation-regularization-single-path.md` | One rule-application path; surfaced regex errors |
| 11 | `11-editor-selection-integrity.md` | Cursor/selection integrity in the transcription editor |
| 12 | `12-tests-verification-docs.md` | Invariant tests, fixtures, docs |

Dependency shape: 01 is independent and first (shrinks the surface). 02 -> 03 -> 04 -> 05 -> 06 is the inversion spine, strictly ordered. 07 and 08 depend on the spine. 09 depends on 06-08. 10 and 11 are independent of sync and can interleave after 05. 12 is last.
