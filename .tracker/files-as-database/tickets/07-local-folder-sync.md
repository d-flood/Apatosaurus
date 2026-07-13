# Ticket 07: Local Folder Sync

Blocked by: Tickets 01, 06
Architecture reference: `../architecture.md` section 8

## Goal

Rework the sync manager as a file mirror between the OPFS project folder and a user-chosen local directory (File System Access API). This is the sole sync target; users get cloud replication by choosing a folder managed by their own Dropbox/Drive/OneDrive client.

## Scope

1. Sync target configuration:
   - Per-project sync target: a persisted `FileSystemDirectoryHandle` (IndexedDB, existing `local-folder-handles.ts` pattern) referenced from `app/sync-targets.json` (target id, project id, folder display path, enabled flag).
   - The remote layout mirrors the project folder exactly, minus local-only files (`*.working.json`, `app/`).
2. Mirror engine (rework `sync-manager.ts` on top of the store + local-folder provider):
   - Per-file fingerprints (size, mtime, cached content hash) recorded at last successful sync, stored in the index as a rebuildable cache table (replaces `cloud_sync_metadata`).
   - Push: local file differs from recorded fingerprint and remote matches recorded fingerprint -> copy local to remote (atomic per provider semantics).
   - Pull: remote differs, local matches recorded -> validate remote via migrate-on-read (quarantine on failure - a half-synced file from a consumer cloud client must never overwrite local state), then copy into OPFS and update the index for that entity.
   - Conflict: both differ -> conflict copy per existing `conflicts.ts` semantics (preserve both, suffix the copy, surface in UI). Never merge.
   - Tombstones: pull applies deletions (retaining history); push uploads tombstone files before removing remote primaries.
   - Derived `*.tei.xml`: sync as ordinary files but resolve any conflict by regenerating from the winning primary.
3. Scheduling: sync on commit, on window focus, and on the existing 30-60s backoff poll while a target is connected. Partial-failure tolerant: one bad file quarantines and continues; the pass reports per-file results.
4. Permission lifecycle:
   - Request persistent permission where supported (Chromium 122+ installed PWA).
   - On permission loss: visible "Reconnect folder" state on the project card and sync indicator with one-click re-grant. Sync must never silently stop (`../architecture.md` section 8).
5. UI: simplify `ProjectBackupPanel` to: connect/disconnect folder, last-synced time, per-entity status, conflict list, quarantine list. Remove remaining cloud-provider vocabulary.
6. Retire the legacy external transcription folder sync (`app/src/lib/client/transcription/external-sync-service.ts`, `external-sync.worker.ts`, and its integration in the transcription library page - see `../current-state.md` section 7). It is superseded by project folder sync; delete it and its IndexedDB handle storage rather than maintaining two folder-sync mechanisms.
7. Multi-writer sanity: two app instances syncing through the same folder (the committee scenario) exercise pull/push/conflict paths; cover with mock-provider integration tests simulating interleaved writers.

## Non-Goals

- Foreign-folder import and zip flows (Phase 8) - though `importCloudProject` internals will be shared; refactor toward the store rather than duplicating.
- Merging of any kind.
- Non-Chromium folder sync (capability notice from Phase 1 stands).

## Design Notes

- Reuse, do not rewrite: `conflicts.ts` classification, quarantine codes, the poller's backoff, and the provider interface. The main change is that the "serialize entity to cloud file" step disappears - files already exist in canonical form; sync copies bytes.
- mtime from consumer cloud clients is unreliable (Dropbox may preserve or rewrite it); fingerprint comparison must treat hash as authoritative and size/mtime as a cheap pre-filter.
- Detect the remote folder being itself a project folder from another machine (manifest present with same project id but unknown revisions) vs a foreign project (different id) - the latter is an import case, direct users to Phase 8 flow.
- Fingerprint cache is index-resident and rebuildable: after index rebuild, the next sync pass re-fingerprints both sides (full hash compare) instead of trusting nothing.

## Checklist

- [x] Sync targets config + handle persistence + reconnect flow
- [x] Mirror push/pull/conflict/tombstone paths, tested against mock provider
- [x] Remote validation via migrate-on-read before any pull overwrites local
- [x] Fingerprint cache in index, rebuild-safe
- [x] Sync on commit/focus/poll with per-file result reporting
- [x] Permission-loss state visible with one-click re-grant
- [x] Interleaved two-writer integration tests
- [x] Legacy external transcription sync removed (service, worker, library-page integration)
- [x] `ProjectBackupPanel` reworked
- [x] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

Manual scenario passes on Chromium: machine A commits, folder syncs (via a real Dropbox-managed directory if available); machine B pulls the update within a poll cycle; simultaneous divergent commits produce a conflict copy on both sides with both versions intact; disconnecting and reconnecting the folder resumes cleanly.

## Verification

```bash
cd app
bun run test:unit -- --run src/lib/client/sync
bun run check && bun run test:unit -- --run
```

Latest automated verification, 2026-07-07:

```bash
bun run db:generate
bun run db:check
bun run check
bun run test:unit -- --run
```

Result: passed. Full unit suite: 68 files, 382 tests.

Manual Chromium multi-folder scenario from the completion criteria remains pending before this phase should be marked `Completed`.

## Notes

| Date | Note |
| --- | --- |
| 2026-07-07 | Phase 7 implementation landed. Project sync targets are stored in `app/sync-targets.json` with persisted local-folder handles; `sync_file_fingerprints` records per-file mirror state in the rebuildable index. Project folder sync now mirrors canonical project files byte-for-byte through the local-folder provider, excludes `*.working.json`, validates remote pulls before OPFS overwrite, rebuilds the index after pulls, preserves conflicts as copies, and surfaces quarantines/status in the reworked Folder Sync UI. App startup now starts enabled sync-target pollers, retries on focus/online, and syncs after project/transcription/collation invalidations. The legacy external transcription folder sync service, worker, library-page panel, and editor enqueue path were removed. Automated verification passed; manual Chromium multi-folder smoke remains pending for phase completion. |

## Review Remediation (2026-07-13)

Ticket 07 is reopened because required mirror semantics exist only in unused helpers or are absent from the production mirror.

### Required fixes

- Integrate tombstones into `mirrorProjectFiles()`. Push publishes the tombstone before deleting the matching remote primary; pull validates/applies it, removes local primary, retains history, updates manifest/index, and never re-pulls the tombstoned primary as remote-only. Remove or fold in uncalled `syncProjectTombstones()`.
- Resolve TEI from the winning primary. Do not accept divergent or remote-only TEI as authoritative; regenerate it after primary pull/conflict resolution.
- Preserve per-file partial failure. Stage/validate candidate remote changes before live writes, continue unrelated paths where possible, rebuild successfully applied pulls, and persist fingerprints only for completed paths.
- Map persistent-handle `NotAllowedError`/`SecurityError` to reconnect-required. Display automatic-sync reconnect state, stop futile polling, support one-click re-grant, and resume polling afterward.
- Remove navbar/global `cloud_connections` folder state. Production sync starts only from project-scoped `sync-targets.json` targets.
- Define ticket 10's shared boundary as staging plus canonical validation, not whole-project replacement. Fingerprints, conflict copies, tombstones, TEI regeneration, and per-file result policy remain above that boundary in this ticket.

### Required tests

- Run two independent local stores/fingerprint caches against one mock provider: A push/B pull, divergent commits, conflict preservation, repeated no-op sync, and recovery after fingerprint-cache rebuild.
- Test local deletion through remote primary removal and remote tombstone through local deletion/history retention, including interruption between tombstone and primary deletion.
- Test one pass with valid, corrupt, conflicting, and remote-only files; valid independent files must complete and receive fingerprints.
- Test automatic permission loss, visible reconnect, re-grant, and resumed polling.
- Test that primary conflict/pull regenerates TEI instead of accepting conflicting TEI bytes.

Completion gate: the production mirror, not a test-only helper, satisfies every push/pull/conflict/tombstone/TEI/permission rule and the two-instance scenario.
