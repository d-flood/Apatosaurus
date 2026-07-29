# 05 — Non-destructive updates

## Parent

`.tracker/offline-capable-pwa/SPEC.md`

## What to build

The current service worker calls `skipWaiting()` on install and then, on activate, deletes every cache whose name is not the incoming version's. A scholar with the app open when a deploy lands therefore has the chunks of the build they are running deleted out from under them; the next lazily imported route fails to load. Their session breaks because someone else pushed to `main`.

This slice makes version transitions safe. A new worker installs and waits rather than seizing control; it takes over when the page says to, or when no clients remain. Activation **retains** caches still referenced by the incoming version instead of deleting wholesale, and always carries the opted-in corpus tier across versions so a scholar does not re-download 38 MB on every deploy. Genuinely unreferenced caches are still cleaned up, so the footprint does not grow without bound. The page is told when an update is ready, so updating is an ordinary offered action rather than a hard-refresh incantation.

## Where to start

- The service worker adapter and `cachesToRetain` from ticket 01. `cachesToRetain` is where the retention rule lives; the adapter's `activate` handler consumes it.
- `app/src/service-worker.ts` as it stands before ticket 01 for the behavior being replaced: `self.skipWaiting()` at the end of `install`, and the `cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))` sweep in `activate`.
- `app/src/lib/client/sw-registration.ts` — already listens for `updatefound` and `statechange` but only logs. This is where the update-ready signal is surfaced to the page.
- `app/src/lib/client/notification-center.svelte.ts` — the existing mechanism for telling the scholar something. Use it rather than inventing a new surface.
- `app/src/routes/+layout.svelte` — where `registerServiceWorker()` is called on mount.

## Contract

`cachesToRetain(existingCacheNames, version)` gains the retention rules:

- Keep every cache belonging to the incoming `version`.
- **Always keep the corpus tier**, regardless of version. It is opted-in, expensive, and its contents are version-independent static files.
- Keep shell and routes caches of the immediately previous version until the new worker actually activates, so a client still running the old build retains its chunks.
- Drop everything older and unreferenced.

Update lifecycle:

- Do **not** call `skipWaiting()` unconditionally at install. The new worker waits.
- The waiting worker activates when the page explicitly asks it to, or when there are no remaining clients.
- Once activated, the newly installed version is warmed in the background by the ordinary ticket-02 path, so a scholar does not silently drop to shell-only readiness after every deploy.
- The page is notified when an update is waiting and can offer a reload.

The scholar must never be force-reloaded. An offered update they ignore is a valid state — do not reload the page out from under someone mid-transcription.

## Out of scope

- Any change to warm execution, gating, or concurrency. Ticket 02 owns those; this slice only ensures a newly activated version gets warmed by the existing path.
- Corpus download or release UI. Ticket 04.
- The readiness panel's layout. Ticket 03. If an update-ready notice needs somewhere to live, use the notification center, not a new panel.
- Version pinning, rollback, or serving multiple app versions concurrently.
- Changing the GitHub Pages deploy workflow or the `version` value SvelteKit generates.

## Acceptance criteria

- [ ] `skipWaiting()` is no longer called unconditionally during install.
- [ ] Node vitest specs cover `cachesToRetain`: keeps the incoming version's caches, keeps the corpus tier across a version change, keeps the immediately previous version's shell and routes caches, and drops older unreferenced caches.
- [ ] A waiting worker activates on an explicit request from the page, and when no clients remain.
- [ ] The page is notified when an update is waiting, via the existing notification center.
- [ ] The scholar is never force-reloaded; ignoring an offered update leaves the session running.
- [ ] A newly activated version is warmed in the background by the existing warm path.
- [ ] `pnpm lint`, `pnpm check`, and the full test suite pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm exec playwright test e2e/offline-capability.spec.ts
pnpm lint
pnpm check
```

Success: the vitest server project reports the retention specs passing; the offline e2e spec still passes.

To verify by hand: `pnpm run preview` and load the app. Rebuild with a change (`pnpm build`), reload once, and confirm in DevTools → Application → Service Workers that the new worker sits in "waiting" rather than taking over, that the update notice appears, and that navigating within the still-open old session does not produce a chunk-loading error.

## Blocked by

- 01 — needs `cachesToRetain` and the tiered cache-name scheme.
