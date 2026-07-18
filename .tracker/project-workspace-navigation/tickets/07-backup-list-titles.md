# 07 — Backup file list shows document titles

## What to build

The per-project backup panel's "Project files" list becomes human-legible: each row leads with the document's title, with the file path as secondary text, instead of headings like "Transcription 0c73ae3b-3c85-41fa-a3fc-62cc345f7f3a". The one permitted panel-internal change in this epic. Demo: the backup section of any project with committed documents shows recognizable titles.

## Where to start

- `app/src/lib/components/projects/ProjectBackupPanel.svelte` — the "Project files" list rendering.
- Title sources: transcription titles via `listTranscriptionSummaries` (`app/src/lib/client/db/repositories/transcriptions.ts`); collation titles via the summaries in `app/src/lib/client/db/repositories/collations.ts`. Join on document id parsed from the file path (`transcriptions/<id>.json`).

## Contract

- Row heading = document title; file path (e.g. `transcriptions/<uuid>.json`) demoted to secondary text.
- Fallback: when no title resolves (orphaned file, unindexed id), render the raw filename as today — never blank.

## Out of scope

- Sync logic, file naming, manifest formats, what the list contains — only row rendering changes.
- Every other part of `ProjectBackupPanel` (statuses, buttons, zip export).

## Acceptance criteria

- [ ] A committed transcription's row shows its title with the path as secondary text; an unresolvable file still shows its filename (component or e2e assertion).
- [ ] `cd app && bun run check && bun run test:unit -- --run` passes (plus `bun run test:e2e` if asserted there).

Commands (run from `app/`): `bun run check`, `bun run test:unit -- --run`, `bun run test:e2e`. Success = all exit 0.

## Blocked by

None - can start immediately.
