# Issue 23: Documentation and Ideas Triage

Architecture reference: `../architecture.md` (all); this epic's `PRD.md`

## What to build

Bring user- and developer-facing documentation up to the final architecture:

1. **READMEs** (repo root and `app/`): architecture summary pointing at `.tracker/files-as-database/architecture.md`; development workflow notes — in particular "bump `INDEX_SCHEMA_VERSION` instead of deleting the DB".
2. **About/onboarding pages**: finalize the issue 16 draft content — recommended setup, data-ownership statement (where files live; how to leave the app with your data: sync folder or zip; every transcription and collation has a TEI sibling).
3. **Contributor notes**: how to add a document format version (upgrader + fixtures + validator) and how to add a storage provider.
4. **`ideas.md` triage**: fold still-relevant items (punctuation handling in collation, collation undo/redo, image caching) into a short future-work section or a fresh ideas file; delete stale entries.

## Where to start

- `README.md` (root) and `app/README.md` — current state unknown; read before writing.
- `ideas.md` at repo root.
- Issue 16's about content — finalize, don't duplicate.
- The migrate-on-read registry and provider interface (`app/src/lib/client/store/migrate-on-read.ts`, `app/src/lib/client/sync/providers/provider.ts`) — the contributor notes document their real extension points; verify against code, not memory.

## Contract

- Contributor docs are verified executable: adding-a-format-version instructions must match what the issue 22 upgrade scenario actually did.
- Docs reference the tracker/architecture docs by path so they survive future epics.
- No new features; wording-only changes to app content beyond the about page belong elsewhere.

## Out of scope

- Test changes (issues 21-22).
- Restructuring `.tracker/` or the architecture document itself.

## Acceptance criteria

- [ ] Both READMEs updated with architecture pointer and index-version workflow.
- [ ] About/data-ownership content finalized.
- [ ] Contributor notes for format versions and providers exist and match the code's actual extension points.
- [ ] `ideas.md` triaged with stale entries removed.
- [ ] Full baseline passes (docs changes should not break it; run anyway).

```bash
cd app
bun run check && bun run test:unit -- --run
```

Success: a contributor can follow the format-version instructions against the real registry; commands pass.

## Blocked by

- 16 (`16-onboarding-and-about-content.md`) — finalizes its draft.
- 21 (`21-invariant-test-suite.md`) — docs describe proven behavior.
