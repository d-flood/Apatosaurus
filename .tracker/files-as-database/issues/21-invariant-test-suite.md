# Issue 21: Data-Safety Invariant Test Suite

Architecture reference: `../architecture.md` section 9 (all invariants)

## What to build

A dedicated suite asserting each data-safety invariant, automated where browser APIs allow, with a documented manual checklist for the rest:

1. **Index deletion is lossless** — extend the issue 06 delete-the-index test to include sync fingerprints and quarantine reports.
2. **Canonical files change only by atomic replacement with newer revisions** — instrument the store in tests to record every write; assert no in-place partial writes.
3. **History is append-only** — attempting a rewrite through any code path fails; grep-level guard plus a runtime assertion in the store for `history/` paths.
4. **Reads never mutate** — checksum the store before/after a full app read pass.
5. **Quarantine never destroys** — corrupt fixtures of every format; assert original bytes untouched.
6. **Crash-ordering leaves readable state** — promote the issue 05 crash tests into the suite, run against both entity types.
7. **Working-state crash survival** — simulate a kill mid-autosave-write; reload recovers the previous working file.
8. **Persistence requested and surfaced** — unit-level assertion (issue 12 behavior); manual checklist for real browser behavior.
9. **Zip round-trip equivalence** — promote the issue 09 round-trip test; run in the CI browser matrix where possible.

Defects surfaced by the suite are fixed here or filed as new issues in this tracker — not left floating.

## Where to start

- New suite home: `app/src/lib/client/store/invariants.spec.ts` (browser mode where OPFS is needed).
- Donor tests to promote: issue 06's delete-the-index browser-worker invariant spec; issue 05's crash-ordering tests in `app/src/lib/client/db/repositories/*-files.spec.ts`; issue 09's round-trip test.
- `app/src/lib/client/store/opfs-store.ts` / `memory-store-backend.spec-support.ts` — where write instrumentation and the `history/` runtime assertion hook in.

## Contract

- Each invariant maps to at least one named test (or a manual-checklist entry committed alongside the suite); the mapping is explicit in the spec file.
- The runtime `history/` append-only assertion ships in production code (cheap guard), not only in tests.
- Promoted tests are moved or wrapped, not duplicated — one authoritative copy each.

## Out of scope

- Playwright end-to-end scenarios and CI wiring (issue 22).
- Documentation (issue 23).
- New features of any kind.

## Acceptance criteria

- [ ] Invariants 1-7 and 9 have passing automated tests; invariant 8's unit-level part passes and its manual checklist is committed.
- [ ] Store write instrumentation exists in test support; the `history/` guard exists in the store proper with a test proving it fires.
- [ ] No duplicated donor tests remain.
- [ ] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/client/store
bun run check && bun run test:unit -- --run
```

Success: the invariants spec names all nine invariants and passes.

## Blocked by

- 07 (`07-local-folder-sync.md`) — fingerprint state in invariant 1.
- 09 (`09-zip-import-staged-ingestion.md`) — round-trip for invariant 9.
- 10 (`10-folder-import-unified-ingestion.md`) — single ingestion path is what invariants exercise.
- 11 (`11-copy-with-lineage-and-refresh.md`) — lineage paths covered by invariants 2-3.
