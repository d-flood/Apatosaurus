# 24 — Retire the legacy entity-restore engine

## Parent

`.tracker/files-as-database/architecture.md`, § 8 "Sync Model" and § 9 "Data-Safety Invariants".

## What to build

Nothing. This ticket deletes.

Ticket 10 was written to retire the pre-inversion restore path, and its success line reads: *"no references to the retired restore internals remain (`grep -r importCloudProject app/src` returns only the new path or nothing)."* Ticket 10 is marked `Completed`. That criterion is not met: `importCloudProject` is still exported from `sync/project-restore.ts` and still wired through `db/client.ts` and `db/db.worker.ts`. The 2026-07-13 note in this tracker had already identified `pullLinkedProjectUpdates()` as "an unused legacy RPC path" and asked for a contract decision that was never recorded. The unification half of ticket 10 landed; the retirement half did not.

So the storage inversion was built *beside* the row-oriented engine rather than through it. Both are exported, both are tested, and they are interleaved in the same files — `sync-manager.ts` holds both, with dead helpers sitting between live ones. Every reader of that file must learn both engines to work on either.

The engine being deleted also contradicts the architecture it was superseded by. `project-restore.ts` imports 18 generated table types and performs **zero** OPFS writes: a project restored through it would exist only in the disposable index, which Invariant 1 forbids. It is unreachable, so this is not a live defect — it is 1,798 lines asserting the opposite of the accepted architecture, held in place by 1,351 lines of tests that certify unshipped behaviour.

## Where to start

Establish the live/dead split by grep before deleting anything. A symbol is **dead** only if its sole references are its own definition, RPC plumbing (`db/client.ts`, `db/rpc.ts`, `db/db.worker.ts`), and `*.spec.ts`. Anything reached from a `.svelte` file, a route, or `app/e2e/` is live.

- `app/src/lib/client/sync/project-restore.ts` (1798) — all six exports are UI-unreachable: `importCloudProject`, `pullLinkedProjectUpdates`, `pollLinkedProjectManifest`, `listCloudProjectCandidates`, and the two manifest-comparison helpers. Delete the module and `project-restore.spec.ts`.
- `app/src/lib/client/sync/sync-manager.ts` (2818) — the dead half is roughly 1,100 lines: `commitProjectTranscriptionForSync`, `commitCollationForSync`, `publishEntity`, `pollOpenEntity`, `publishProjectManifest`, `listProjectArchiveFiles`, `deriveLocalSyncUiState`, `syncProviderErrorResult`, plus their private helpers (`ensureHistoryFile`, `serializePrimaryFile`, `putCloudFile`, `downloadRemoteEntity`, `applyRemoteEntity`, `insertRemoteCheckpoint`, the `apply*Primary` pair, `getSyncMetadata`, `upsertSyncMetadata*`, `listRemoteMetadata`). Keep `mirrorProjectFiles` and everything it reaches.
- `app/src/lib/client/sync/conflicts.ts` (895) — six of eleven exports are spec-only: `createProjectTranscriptionTombstone`, `createCollationTombstone`, the two `classifyTombstoneAgainst*`, and the two `apply*Tombstone`. Verify each against the live mirror path before removing; the mirror path has its own tombstone handling and may reach some of these.
- `app/src/lib/client/store/formats/cloud-files-adapter.ts` (1308) — delete the `*CloudFile` ⇄ canonical-payload translation (~500 lines) and the five types it redeclares that already exist in `formats/project-manifest.ts` and `formats/project-transcription.ts`. Keep the ~700 lines of DB-read functions; they are live, though misplaced (see Out of scope).
- `app/src/lib/client/sync/providers/provider.ts` — `shareFolder` throws in all three implementations, and five of eight `CloudProviderCapabilities` flags are never branched on. `listFiles`' `cursor` pagination exists only in the mock.
- RPC plumbing for every deleted export, in all three of `db/client.ts`, `db/rpc.ts`, `db/db.worker.ts`.

## Contract

- **Delete only what is provably unreachable.** Grep first, per the rule above. Do not delete a symbol because this ticket names it — the ticket's list was derived from a point-in-time audit and the code may have moved.
- **`mirrorProjectFiles` and its call graph are untouched.** File replication, per-file fingerprints, conflict copies, tombstone propagation, and the poller all stay exactly as they are. This ticket removes the *other* engine; it does not refactor the surviving one.
- **The provider seam stays.** `architecture.md` § 6 keeps `StorageProvider` pluggable for future targets (Tauri native FS, institutional WebDAV, restored OAuth providers). That commitment is about the *seam*, not about retaining methods shaped by the providers that were removed. Delete `shareFolder` and the capability flags nothing reads; a future provider adds back what it actually needs. `supportsExpectedRevisionDelete` is read at two live sites and stays.
- **The cloud tables stay.** `cloud_connections` and `cloud_project_folders` remain in `0001_initial.sql`, so `INDEX_SCHEMA_VERSION` is **not** bumped. Note that they are not uniformly dead: `upsertCloudProjectFolder` is called from the live `backupProject` path via `ensureProjectBackupFolder`. Keep `repositories/cloud-connections.ts` and remove only its provably unreachable exports.
- **Delete the tests with the code they cover.** `project-restore.spec.ts` goes with its module. In `sync-manager.spec.ts`, remove the cases that drive deleted exports (`commitProjectTranscriptionForSync`, `publishEntity`, `pollOpenEntity`, `listProjectArchiveFiles`) and keep everything covering `mirrorProjectFiles` — in particular the two-store convergence case, which is the strongest test in the area. Do not weaken a surviving assertion to make a suite pass.
- **No behaviour change.** If any deletion changes what the app does, the symbol was not dead and the grep was wrong. Stop and re-audit rather than adjusting a test.

## Out of scope

- **Moving the surviving DB-read functions out of `store/formats/cloud-files-adapter.ts`.** They import Kysely into a canonical-format module, which is wrong, but relocating them is a separate change with its own blast radius. Leave them where they are.
- **The `sync/canonical-json.ts`, `sync/cloud-files.ts`, and `sync/cloud-paths.ts` re-export shims,** and the dead `sync/sync-service.ts` stub. These are pure indirection and create a false `store → sync` dependency edge, but they are their own cleanup and are not required to retire this engine.
- **Dropping the cloud tables** and bumping `INDEX_SCHEMA_VERSION`. Deliberately deferred; see Contract.
- **Consolidating the payload → row mappers.** The `transcriptions` row mapping exists in six places; deleting this engine removes three of them. Unifying the survivors is separate work.
- Any change to the transcription or collation commit paths.

## Acceptance criteria

- [ ] `grep -rn "importCloudProject\|pullLinkedProjectUpdates\|pollLinkedProjectManifest\|listCloudProjectCandidates" app/src app/e2e` returns nothing — ticket 10's original success line, finally satisfied.
- [ ] `sync/project-restore.ts` and `sync/project-restore.spec.ts` no longer exist.
- [ ] The named dead exports are gone from `sync-manager.ts`, `conflicts.ts`, and `cloud-files-adapter.ts`, together with their RPC plumbing in `db/client.ts`, `db/rpc.ts`, and `db/db.worker.ts`.
- [ ] `provider.ts` no longer declares `shareFolder` or the capability flags nothing branches on; no implementation contains a method that only throws.
- [ ] `0001_initial.sql` is unchanged and `INDEX_SCHEMA_VERSION` is unchanged.
- [ ] The two-store convergence test in `sync-manager.spec.ts` still passes, unmodified.
- [ ] `app/src/lib/client/sync` is materially smaller; record the before/after line count in the completion note.
- [ ] The full unit and browser suites pass, and the Playwright suite passes.
- [ ] `pnpm lint` and `pnpm check` pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm run test:unit -- --run --project client
pnpm run test:e2e
pnpm lint
pnpm check
```

## Blocked by

None. Ticket 10's unification half is complete; this is its retirement half.
