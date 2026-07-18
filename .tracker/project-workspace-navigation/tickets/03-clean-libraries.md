# 03 — Clean libraries: settings split + row delete

## What to build

The two project libraries become clean scholarly worklists (glossary: *project transcription library*). The transcriptions section drops all collation configuration — witness treatments, hand exclusions, and the cross-project versions panel move to the Settings section beside the regularization rules they belong with. Both libraries gain Delete behind a per-row overflow menu (⋯), driving the existing confirmation and deletion machinery. Demo: open a project's transcriptions — a plain list of documents with Open and an overflow menu; open Settings — all witness configuration in one place; delete a transcription and a collation from their rows.

## Where to start

- The routes slice 02 created: the transcriptions sub-route (currently rendering `ProjectTranscriptionsEditor` + `ProjectTranscriptionVersionsPanel`) and the settings sub-route (currently project details + `ProjectCollationSettingsEditor` + `ProjectUserManagementStub`).
- Library row shape to build: title, siglum, commit state, last-updated, Open. Data: `listProjectTranscriptionStatuses` in `app/src/lib/client/collation/project-collation.ts` (already powers the versions panel) and `listTranscriptionSummaries` in `app/src/lib/client/db/repositories/transcriptions.ts`.
- Deletion functions (semantics already defined — tombstones, index cleanup, sync propagation): `deleteTranscription` exported from `app/src/lib/client/db/client.ts`; the collation equivalent in `app/src/lib/client/db/repositories/collations.ts` via the entity-deletion machinery (`app/src/lib/client/db/repositories/entity-deletion.ts`).
- Confirm-dialog precedent: `handleDelete` in the old global library `app/src/routes/transcription/(library)/+page.svelte` (browser `confirm()`; that file itself is deleted in slice 05 — copy the pattern, not the file).
- Collation list rows (title, verse identifier, commit state, phase badge, Open) exist in the collations section from slice 02 — they only gain the overflow menu.

## Contract

- The transcription library page contains zero witness-treatment or hand-exclusion controls.
- `ProjectTranscriptionsEditor` and `ProjectTranscriptionVersionsPanel` move to the settings sub-route by import path only; internals untouched.
- Delete = existing browser `confirm()` + existing repository functions. No new modal, no new semantics, no cascade changes.
- No always-visible red Delete button on any library row; the action lives only in the overflow menu.

## Out of scope

- The mega-page at `/projects`, the navbar, legacy routes (slices 04, 05).
- Internals of the moved components and of the deletion/entity-deletion machinery.
- Any change to what "delete" means — presentation only.

## Acceptance criteria

- [ ] Transcription library renders title/siglum/commit-state/updated/Open rows and no collation config (e2e or component assertion).
- [ ] Settings section hosts project details, collation settings, witness treatments, hand exclusions, and the versions panel, and saving each still works (e2e).
- [ ] Deleting a transcription and a collation via the overflow menu removes the row and survives reload; Cancel is a no-op (e2e).
- [ ] Any new phosphor icon is in `optimizeDeps.include` in `app/vite.config.ts`.
- [ ] `cd app && bun run check && bun run test:unit -- --run && bun run test:e2e` passes.

Commands (run from `app/`): `bun run check`, `bun run test:unit -- --run`, `bun run test:e2e`. Success = all exit 0.

## Blocked by

- 02 — project workspace routes (the sections this slice rearranges).
