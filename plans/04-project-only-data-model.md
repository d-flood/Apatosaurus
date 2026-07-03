# Phase 04: Project-Only Data Model, Index-Only Schema

Status: Not Started
Depends on: Phase 03
Architecture reference: `architecture.md` sections 3 (decisions 1-3), 7

## Goal

Land the project-only ownership model (folded in from the superseded project-only-transcriptions plan) and rewrite the SQLite schema as an explicitly derived index. After this phase the schema contains nothing that cannot be rebuilt from canonical files.

## Scope

### Ownership model

1. Every transcription and collation belongs to exactly one project. Remove the `scope_type` global/`project_snapshot` split: all transcriptions are project-owned.
2. Auto-create a `Default` project on first run (and on rebuild if no projects exist yet but orphan entities are found).
3. Projects get an immutable `storage_slug` (initial name slug + unique suffix) used as the OPFS folder name. Renames never change the slug.
4. Creation and import flows require a project id, defaulting to `Default`. Creation writes an initial committed version (file-level, activated in Phase 5; until then keep the existing checkpoint write).
5. Cross-project copy keeps lineage: copying a transcription into another project duplicates the document and sets `origin_*` fields. The refresh flow (`ProjectTranscriptionRefreshDialog`) stays explicit and user-confirmed.

### Index-only schema rewrite

Edit `app/src/lib/client/db/migrations/0001_initial.sql` directly (greenfield). The full current table inventory with per-table fates is in `current-state.md` section 3; the summary:

6. Keep, as derived tables: `projects` (plus `storage_slug`), `transcriptions` metadata columns, `transcription_verse_index`, `project_transcriptions`, `collations`, collation projection tables (`collation_witnesses`, `collation_tokens`, `collation_variation_units`, `collation_readings`, `collation_reading_witnesses`), and lightweight checkpoint *listings* (id, parent, message, author, created_at, content_hash - no payloads).
7. Remove: `cloud_connections`, `cloud_project_folders`, `cloud_sync_metadata` (sync state cache is redefined in Phase 7), `collation_artifacts` payload-as-truth role, and checkpoint `payload` columns. During this phase content still lives in `transcriptions.content_json` and `collation_artifacts` as a working cache; mark them clearly as cache columns slated for demotion in Phase 5/6. Record in Notes what remains temporarily.
8. Regenerate types (`bun run db:generate`), fix repositories and RPC (`db.worker.ts`, `rpc.ts`, `client.ts`) for the new shape.

### UI flows

9. Transcription library route becomes project-scoped: the `(library)` list shows transcriptions grouped by project, or moves under a project detail view (full navigation polish lands in Phase 9; here, only ensure no flow can create or show an unowned transcription).
10. New-transcription and IGNTP-import flows include project selection defaulting to `Default`.
11. Collation creation requires a project and only offers witnesses from that project's transcriptions.

## Non-Goals

- No OPFS writes from feature paths yet (Phase 5).
- No index rebuild mechanics (Phase 6).
- No navigation redesign beyond preventing unowned entities (Phase 9).

## Design Notes

- This intentionally supersedes plan documents 01-10 of the old project-only-transcriptions series; their decisions are preserved except cloud-folder specifics, which are replaced by the OPFS layout in `architecture.md` section 4.
- Slug generation: lowercase, ASCII-fold, hyphenate, trim to ~40 chars, append short random suffix; collision-check against existing project slugs.
- Keep `owner_id`/`added_by_id` columns only if something reads them; otherwise drop (no accounts remain after Phase 1).

## Checklist

- [ ] `Default` project auto-creation, tested
- [ ] `storage_slug` on projects, immutable, tested
- [ ] No code path creates or lists an unowned transcription or collation
- [ ] Schema rewritten; removed tables gone; types regenerated
- [ ] Repositories/RPC updated; all existing repository tests updated and passing
- [ ] Creation/import/collation flows require project, default to `Default`
- [ ] Copy-with-lineage between projects works with `origin_*` set
- [ ] `bun run db:generate && bun run db:check` clean
- [ ] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

The app runs with the new schema; every entity has a project; the schema contains no OAuth/token tables; everything remaining is either derived or explicitly marked as a temporary cache column with a pointer to the phase that demotes it.

## Verification

```bash
cd app
bun run db:generate && bun run db:check
bun run test:unit -- --run src/lib/client/db
bun run check && bun run test:unit -- --run
```

## Notes

| Date | Note |
| --- | --- |
