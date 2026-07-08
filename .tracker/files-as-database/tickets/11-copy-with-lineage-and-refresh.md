# Ticket 11: Copy-with-Lineage and Refresh-from-Source

Architecture reference: `../architecture.md` section 3 (decision 3)

## What to build

The two cross-project reuse flows work end-to-end through the file-first write paths:

1. **Add transcription from another project**: copies the committed document into the target project as a new entity (new id, `origin_*` lineage fields set) through the normal ticket 05 creation path — initial history checkpoint, committed primary, TEI sibling, manifest head, index rows.
2. **Refresh from source**: shows source vs local commit hashes, requires explicit confirmation, creates a local checkpoint of the current state before replacing content (preserving the existing draft-preservation semantics).

## Where to start

- `app/src/lib/components/projects/AddProjectTranscriptionFromProjectDialog.svelte` and `ProjectTranscriptionRefreshDialog.svelte` — the existing dialogs; this ticket reroutes their persistence, consolidating rather than redesigning them.
- `app/src/lib/client/db/repositories/transcription-files.ts` — the file-aware creation/commit wrappers from ticket 05.
- `app/src/lib/client/sync/conflicts.ts` — `preserve*DraftCheckpoint` semantics referenced by refresh.
- Lineage fields already exist on the canonical transcription format (ticket 03/04 work); this ticket exercises them, it does not add schema.

## Contract

- Copy always creates a new entity id; it never links or shares. `origin_*` fields record source project, entity, revision, and hash.
- Refresh never proceeds without explicit confirmation and never destroys local state: a checkpoint of the pre-refresh committed state (and preservation of any working draft) exists afterward.
- Both flows go through the standard commit sequence — no direct index writes that bypass files.
- No automatic refresh, no background staleness resolution (display-only staleness is ticket 15).

## Out of scope

- Staleness indicators in headers/lists (ticket 15).
- Cross-project collation copying (not a product feature).
- Any merging.

## Acceptance criteria

- [ ] Copying a transcription produces canonical files (history, primary, TEI, manifest head) in the target project with `origin_*` set; verified against the store in tests.
- [ ] Refresh with a diverged source requires confirmation, writes a pre-refresh checkpoint, then replaces the committed primary; history from before the refresh remains loadable.
- [ ] Refresh on an up-to-date copy reports no-op without writes.
- [ ] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/client/db/repositories
bun run check && bun run test:unit -- --run
```

Success: repository suites include copy and refresh file-path tests, all passing.

## Blocked by

None - can start immediately (ticket 06 is Completed).
