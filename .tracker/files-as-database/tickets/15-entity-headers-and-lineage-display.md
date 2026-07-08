# Ticket 15: Entity Headers and Lineage Display

Architecture reference: `../architecture.md` section 3 (decision 3)

## What to build

1. **Entity headers**: the transcription editor and collation workspace show the owning project name and the commit state (committed at revision X / uncommitted changes), making ownership and committed-vs-draft state visible at all times.
2. **Lineage surfacing**: a copied transcription shows "copied from `<project>` @ `<short-hash>`" with a staleness indicator when the source has newer commits. The data already exists from tickets 04/11 (`origin_*` fields, revision hashes); this is display work.

## Where to start

- `app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte` and `app/src/routes/transcription/[id]/` — where the editor header renders.
- `app/src/lib/components/collation/CollationWorkspace.svelte` and `CollationStepper.svelte` — the collation workspace chrome.
- Commit state: working-file presence / dirty status from the ticket 05 load paths; committed head from the manifest/index listings.
- Staleness: compare the copy's `origin_revision`/hash against the source entity's current head via existing listings; a pure comparison function, no new persistence.

## Contract

- Headers derive from existing load/list data; no new RPCs that ship full content just for a label.
- Staleness display is informational; refreshing remains the explicit ticket 11 flow (link to it, do not trigger it).
- Copied-from display degrades gracefully when the source project or entity no longer exists (show provenance, mark source unavailable).

## Out of scope

- Navigation/tab structure (ticket 14).
- Refresh-from-source behavior (ticket 11).
- Any editor content or selection behavior (tickets 19-20).

## Acceptance criteria

- [ ] Editor and collation workspace headers show project name and commit state; component tests cover committed, dirty, and never-committed states.
- [ ] A copied transcription renders origin project + short hash; staleness indicator appears exactly when the source head differs (tested with a stale and a current fixture).
- [ ] Missing-source case renders without error.
- [ ] Full baseline passes.

```bash
cd app
bun run check && bun run test:unit -- --run
```

Success: full suite passes with the new component tests.

## Blocked by

- 14 (`14-project-first-navigation.md`) — headers assume the project-context chrome it establishes.
