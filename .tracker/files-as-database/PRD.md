# PRD: Files Are the Database

This PRD is the product framing for the storage inversion. The authoritative technical reference is `architecture.md` (accepted 2026-07-03); the pre-inversion codebase audit is `current-state.md`. Where this document and `architecture.md` disagree, `architecture.md` wins.

## Problem Statement

Apatosaurus is a local-first PWA for creating digital critical apparatuses and editions (transcription + collation) of manuscript texts. Its users — scholars and editing committees — accumulate months of irreplaceable transcription and collation work inside a browser database they cannot see, back up, or repair. A 2026-07-03 audit found:

- The SQLite database in OPFS was the source of truth; a botched migration was unrecoverable, making every schema change a data-loss risk.
- The same data persisted redundantly in up to five places with lossy merge steps between them; the known editor bugs (cursor jumps to a different line, collation rules not applied consistently) are symptoms of these duplicated representations.
- There is no funding for a hosted database or server. Users must own their data.

## Solution

Invert the persistence hierarchy: **a project is a folder of versioned, hash-validated JSON document files; SQLite is a disposable index rebuilt from those files.** Deleting the database loses no user data. Users get their data out via a synced local folder (which they may point at a Dropbox/Drive/OneDrive-managed directory — the Obsidian/Zotero model) or via zip export, and every transcription and collation has an always-fresh TEI sibling file as an archival exit.

## User Stories

1. As a scholar, I want my project stored as plain files I can inspect and copy, so that my work is never trapped inside an opaque browser database.
2. As a scholar, I want the app to recover automatically from a corrupt or deleted index database, so that a browser glitch never destroys my work.
3. As a scholar, I want a "Repair database" action, so that I can recover from odd states myself without support.
4. As a scholar, I want every transcription and collation to belong to a project, so that ownership of my materials is always clear.
5. As a new user, I want a Default project created for me, so that I can start transcribing without ceremony.
6. As a scholar, I want to commit checkpoints of my work with messages, so that I have a permanent, append-only history.
7. As a scholar, I want my uncommitted drafts autosaved locally and to survive a crash, so that I never lose in-progress typing.
8. As a scholar, I want to connect a project to a folder on my computer that stays in sync, so that my committed work is continuously backed up outside the browser.
9. As a committee member, I want to point that sync folder at a directory my Dropbox/Drive/OneDrive client manages, so that colleagues on other machines receive my committed work.
10. As a committee member, I want simultaneous divergent commits preserved as conflict copies (never merged silently), so that no one's reading is lost.
11. As a scholar, I want the app to tell me visibly when folder sync has lost permission or stopped, so that I am never silently unprotected.
12. As a Firefox/Safari user, I want zip export and import of whole projects, so that I have a full backup path without folder sync.
13. As a scholar, I want to export all projects at once, so that whole-account backup is one action.
14. As a scholar, I want to import a project from a zip or folder with validation before anything is written, so that a bad archive cannot corrupt existing data.
15. As a scholar, I want to copy a transcription from another project with its provenance recorded, so that I can reuse witnesses across editions.
16. As a scholar, I want to see when a copied transcription's source has newer commits and refresh it explicitly, so that reuse stays current without automatic merging.
17. As a scholar, I want the app to request persistent storage and warn me when my data exists only in this browser, so that eviction or a lost laptop cannot take months of work.
18. As a scholar, I want a per-project backup-health view (last committed, last synced, last exported), so that I can see at a glance what is protected.
19. As a new user, I want first-run guidance toward the recommended setup (Chromium, installed PWA, persistent storage, sync folder), so that I start protected.
20. As an editor, I want the regularization preview to show exactly the tokens that will be collated, so that "rules don't seem applied" stops being a mystery.
21. As an editor, I want invalid regularization rules surfaced as errors and per-rule effects inspectable, so that I can debug my own rules.
22. As an editor working in polytonic Greek, I want rule matching to be Unicode-correct and normalization stable, so that breathings, iota subscript, and final sigma behave predictably.
23. As an editor, I want a visible "re-run needed" state when rules or settings change after alignment, so that the table never silently disagrees with my settings.
24. As a transcriber, I want my cursor to stay put while autosave, structure repair, and page navigation happen, so that typing is never derailed.
25. As a scholar, I want TEI files exported alongside every committed transcription and collation, so that my work remains usable if the app dies.
26. As a contributor, I want documented procedures for adding a document format version or a storage provider, so that the architecture outlives its authors.

## Implementation Decisions

Full detail in `architecture.md` sections 3-8. The binding decisions:

1. Canonical persistence is a per-project folder of JSON files in OPFS; SQLite holds only derived data (listings, verse index, collation projections, search) and is stamped with an index schema version. Schema changes drop and rebuild the index; they never migrate it.
2. Transcriptions and collations are always project-owned; every user gets an automatic `Default` project; there is no global library.
3. Cross-project sharing is copy-with-lineage (`origin_*` provenance, explicit user-confirmed refresh-from-source). No live sharing, no automatic merge, no CRDTs.
4. Committed state is the sync boundary; working (uncommitted) state is local-only files, never synced.
5. Direct cloud OAuth providers are removed. The sync target is a user-chosen local folder (File System Access API, Chromium). The `StorageProvider` interface stays pluggable for future targets.
6. Zip export/import is a first-class, all-browsers feature and the universal backup path.
7. Every canonical file carries a common envelope (`format`, `schema_version`, `content_hash`); schema evolution is migrate-on-read with pure upgrade functions and fixture files; unreadable files are quarantined and surfaced, never silently dropped.
8. Commit ordering: history checkpoint, then committed primary, then best-effort derived TEI, then project manifest last; index rows update after files. A crash at any point leaves the folder readable.
9. Sync is byte-level file mirroring with per-file fingerprints; divergence on both sides produces conflict copies; deletions propagate via tombstones that never remove history.
10. TEI is a derived interchange/archival format regenerated on commit, not the source of truth.
11. Greenfield: no compatibility with pre-inversion browser databases.

Cross-cutting constraints every issue must respect:

- Preserve the data-safety invariants in `architecture.md` section 9 at every issue boundary.
- Local save and commit must succeed even when sync writes fail; sync failures surface as status, not failed saves.
- Nothing irreplaceable may live in the SQLite index.
- Reuse existing primitives (canonical JSON hashing, quarantine codes, conflict-copy semantics, provider interface, staged ingestion once built) instead of building parallel ones.
- The greenfield index schema is edited directly; index versioning (bump `INDEX_SCHEMA_VERSION`, rebuild from files) is the only migration mechanism.

## Testing Decisions

- Tests assert external behavior (files written, documents loadable, listings correct, selection stable), not implementation internals.
- Unit tests run in vitest with a browser/node split; real-OPFS coverage uses browser mode; Playwright covers end-to-end scenarios (fresh user, disaster recovery, committee sync, upgrade).
- The data-safety invariants (`architecture.md` section 9) get a dedicated automated suite (issue 21); invariants that browsers will not allow to be automated get a documented manual checklist.
- Prior art: the existing store, repository, and sync spec files established during issues 02-07 (memory store backend, mock provider, fixture-backed migrate-on-read tests).
- Every issue leaves the full baseline green: `bun run db:generate && bun run db:check && bun run check && bun run test:unit -- --run` from `app/`.

## Out of Scope

- Tauri desktop distribution (must not be precluded; the static build + provider seam keep it a small wrapper later).
- Institutional server provider (WebDAV or dumb HTTP file store), restored direct Dropbox/Drive API providers.
- Realtime/multiplayer collaboration, automatic merging, CRDTs (deliberately rejected — see `architecture.md` section 10).
- Multi-user permissions UI.
- Visual redesign beyond information architecture; the existing DaisyUI component system stays.

## Further Notes

- Read `architecture.md` before implementing any issue; read `current-state.md` instead of re-auditing the pre-inversion codebase. Phase docs referenced there were converted to `issues/` — see `TRACKER.md` for the mapping and status.
- Issues 01-07 are the completed foundation (converted phase documents, kept for their implementation notes). Issues 08-23 are the remaining vertical slices.
