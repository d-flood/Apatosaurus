# Phase 12: Tests, Verification, and Docs

Status: Not Started
Depends on: Phases 01-11
Architecture reference: `architecture.md` section 9 (all invariants)

## Goal

Prove the data-safety invariants hold end-to-end, close testing gaps discovered along the way, and update user- and developer-facing documentation to the final architecture.

## Scope

### Invariant test suite

Create a dedicated suite (`app/src/lib/client/store/invariants.spec.ts` or e2e where browser APIs demand) asserting each invariant from `architecture.md` section 9:

1. Index deletion is lossless (automated; extends Phase 6 test to include sync fingerprints and quarantine reports).
2. Canonical files only change by atomic replacement with newer revisions (instrument the store in tests to record every write; assert no in-place partial writes).
3. History append-only (attempting rewrite in any code path fails the suite; grep-level guard plus runtime assertion in the store for `history/` paths).
4. Reads never mutate (checksum the store before/after full app read pass).
5. Quarantine never destroys (corrupt fixtures of every format; assert original bytes untouched).
6. Crash-ordering leaves readable state (Phase 5 tests promoted into the suite, run against both entity types).
7. Working-state crash survival (kill autosave mid-write simulation; reload recovers previous working file).
8. Persistence requested and surfaced (unit-level; manual checklist for browser behavior).
9. Zip round-trip equivalence (Phase 8 test promoted; run in CI browser matrix where possible).

### End-to-end scenarios (Playwright)

- Fresh user: create project -> transcribe -> commit -> collate -> commit -> export zip.
- Disaster recovery: wipe site data -> import zip -> verify equivalence.
- Committee: two contexts sharing a mock/local folder -> update propagation -> divergent-commit conflict copies.
- Upgrade: fixture store at synthetic older document versions -> app opens, migrate-on-read upgrades on save, index rebuilds on version bump.

### Documentation

- `README.md` (root and `app/`): architecture summary pointing at `plans/architecture.md`; development workflow ("bump INDEX_SCHEMA_VERSION instead of deleting the DB").
- About/onboarding pages: final recommended-setup content (Phase 9 draft finalized), data-ownership statement (where files live, how to leave the app with your data: sync folder or zip; every transcription and collation has a TEI sibling).
- `ideas.md` triage: fold still-relevant items (punctuation handling, collation undo/redo, image caching) into a short future-work section here or a fresh ideas file; delete stale entries.
- Contributor notes: how to add a document format version (upgrader + fixtures + validator), how to add a provider.

### Gap closure

- Reserve time for defects surfaced by the suite; track them in this document's Notes table rather than letting them float.

## Non-Goals

- New features. This phase hardens and documents.

## Checklist

- [ ] Invariants 1-9 asserted (automated where possible; manual checklist documented for the rest)
- [ ] Playwright scenarios: fresh user, disaster recovery, committee, upgrade
- [ ] CI runs unit + browser suites (extend `.github/workflows` as needed)
- [ ] READMEs, about pages, contributor notes updated
- [ ] `ideas.md` triaged
- [ ] Full baseline green: `bun run db:generate && bun run db:check && bun run check && bun run test:unit -- --run` and Playwright suite

## Completion Criteria

All invariants demonstrably hold; a contributor can add a format version or provider from docs alone; a user can understand where their data lives and how to take it elsewhere without reading code.

## Verification

```bash
cd app
bun run db:generate && bun run db:check
bun run check
bun run test:unit -- --run
bunx playwright test
```

## Notes

| Date | Note |
| --- | --- |
