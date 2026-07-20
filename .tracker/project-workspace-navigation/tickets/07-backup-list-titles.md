# 07 — Backup file list shows document titles

## What to build

The per-project backup panel's "Project files" list becomes human-legible: each row leads with the document's title, with the file path as secondary text, instead of headings like "Transcription 0c73ae3b-3c85-41fa-a3fc-62cc345f7f3a". A rendering change plus one new read-only title lookup. Demo: the backup section of any project with committed documents shows recognizable titles.

## Where to start

- `app/src/lib/components/projects/ProjectBackupPanel.svelte` — the "Project files" list rendering.
- Key fact (verified 2026-07-18; an earlier revision of this ticket got it wrong): transcription backup files are keyed by `project_transcriptions.id` — see `listProjectTranscriptionReferences` in `app/src/lib/client/sync/sync-manager.ts` — so titles require the `project_transcriptions` → `transcriptions` join. Collation files are keyed by `collations.id` directly. Parsing the path and joining against `listTranscriptionSummaries` cannot work.
- Put the new lookup beside `listProjectTranscriptionStatuses` in `app/src/lib/client/db/repositories/projects.ts`; expose it through the worker client (`app/src/lib/client/db/client.ts`) like the other list functions.

## Contract

- Row heading = document title; file path (e.g. `transcriptions/<uuid>.json`) demoted to secondary text.
- Fallback: when no title resolves (orphaned file, unindexed id), render the raw filename as today — never blank.
- The new lookup, one call per project, plain joins only:

  ```ts
  listProjectDocumentTitles(db, projectId): Promise<{
  	entityType: 'project-transcription' | 'collation';
  	entityId: string; // project_transcriptions.id or collations.id — matches the backup file key
  	title: string;
  }[]>
  ```

- Do NOT use `listProjectTranscriptionStatuses` for this: its per-row `mapProjectTranscriptionStatus` derivation (checkpoint/source/backup state) is wasted work for a title, and this panel must stay cheap.

## Out of scope

- Sync logic, file naming, manifest formats, what the list contains — rendering plus the one read-only lookup above, nothing else.
- Every other part of `ProjectBackupPanel` (statuses, buttons, zip export).

## Acceptance criteria

- [ ] A committed transcription's row shows its title with the path as secondary text; an unresolvable file still shows its filename (component or e2e assertion).
- [ ] A collation file's row shows the collation title.
- [ ] `listProjectDocumentTitles` has a repository unit test covering both entity types and a project with no documents (prior art: `app/src/lib/client/db/repositories/projects.spec.ts`).
- [ ] `cd app && bun run check && bun run test:unit -- --run` passes (plus `bun run test:e2e` if asserted there).

Commands (run from `app/`): `bun run check`, `bun run test:unit -- --run`, `bun run test:e2e`. Success = all exit 0.

## Blocked by

None - can start immediately.
