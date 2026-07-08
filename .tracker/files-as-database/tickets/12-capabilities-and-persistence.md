# Ticket 12: Capabilities Module and Storage Persistence

Architecture reference: `../architecture.md` sections 3 (decision 8), 9 (invariant 8)

## What to build

Durability plumbing plus its settings surface, end-to-end:

1. A single `capabilities.ts` module reporting `showDirectoryPicker` support, OPFS support, persistence state, and PWA install state — consumed by all capability notices, replacing scattered feature checks.
2. `navigator.storage.persist()` requested at first meaningful write and re-checked on startup; the result (granted / denied / unsupported) shown in settings.
3. A warning banner when user data exists but persistence is not granted ("your browser may evict this data under storage pressure — install the app or export backups"). Dismissible, but recurs on new data milestones (e.g. first commit in a new project), not on every load.
4. Storage estimate display (`navigator.storage.estimate()`) in settings, with a warning as usage approaches quota.

## Where to start

- Grep for existing feature detection (`showDirectoryPicker`, `getDirectory`, `storage.persist`) across `app/src/lib/client` — those call sites migrate to `capabilities.ts`.
- `app/src/routes/+layout.svelte` — startup sequencing for the re-check.
- The store write path (`app/src/lib/client/store/opfs-store.ts` / the repositories that call it) — hook for "first meaningful write".
- Settings UI: the Projects page Local Storage card (added in ticket 06) is the current settings-like surface; place status there or in the project Settings section once ticket 14 lands (coordinate via TRACKER note, don't block).

## Contract

- `capabilities.ts` is the only module that touches these browser APIs directly; everything else consumes its reported state.
- Persistence request happens once per session at most, tied to a meaningful write, not app load.
- Banner logic (data exists ∧ not persisted ∧ not recently dismissed ∨ new milestone) is a pure, tested function; the component only renders its output.
- Persistence denial is common (non-installed Chromium, Firefox private mode) — the state is informational, never blocking.

## Out of scope

- The PWA install nudge and backup-health panel (ticket 13).
- Onboarding/first-run content (ticket 16).
- Navigation restructure (ticket 14).

## Acceptance criteria

- [ ] `capabilities.ts` exists and no other module calls `showDirectoryPicker` detection, `storage.persist`, or `storage.estimate` directly (grep-verifiable).
- [ ] Persist requested on first meaningful write; status re-checked at startup; both unit-tested with mocked `navigator.storage`.
- [ ] Banner condition function tested across the state matrix (no data, data+granted, data+denied, dismissed, new milestone after dismissal).
- [ ] Storage estimate rendered in settings with quota warning threshold tested.
- [ ] Full baseline passes.

```bash
cd app
bun run check && bun run test:unit -- --run
```

Success: full suite passes including the new capabilities/persistence tests.

## Blocked by

None - can start immediately (ticket 06 is Completed).
