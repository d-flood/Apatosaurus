# 01 — Shell tier and offline boot

## Parent

`.tracker/offline-capable-pwa/SPEC.md`

## What to build

Make the app boot with the network off. Today it cannot: the build emits no `index.html` (nothing is prerendered), so GitHub Pages serves the adapter-static fallback `404.html` with an HTTP **404 status**. The service worker precaches `/` and `/offline` with `cache.add()`, which rejects on any non-2xx response, and both failures are swallowed by a `console.warn`. The navigation handler only writes to the cache when `networkResponse.ok`. Net effect: **no HTML ever enters the cache**, and an offline reload falls all the way through to a plain-text `503 Offline` response.

This slice extracts every caching *decision* into a new pure module, reduces the service worker to a thin adapter over that module, precaches a small **shell tier** at install, and serves the cached shell for **every** navigation request (cache-first, revalidate in background) so the SvelteKit client router resolves the actual route. The `/offline` route is retired — a working shell makes a second, worse shell pointless.

Route chunks continue to be precached during `install` exactly as they are today. Do not change that in this slice; moving them to a background warm is ticket 02. The observable win here is that the app boots offline at all.

## Where to start

- `app/src/service-worker.ts` — the whole current implementation. Read it first; note `PRECACHE_URLS` (line ~7), the swallowed `cache.add` failure (line ~37), `handleNavigation`'s `networkResponse.ok` guard (line ~79), and the `503 Offline` fallback (line ~94).
- `app/src/lib/client/capabilities.ts` and `capabilities.spec.ts` — the prior art for this slice's new module. Same shape: an environment-adjacent module written as pure functions returning plain report objects, tested in node vitest with globals stubbed. Match its style.
- `app/svelte.config.js` — `adapter-static({ fallback: '404.html' })`, `serviceWorker.register: false`, `paths.assets: ''`. Confirms the SPA-with-fallback shape.
- `app/src/lib/client/sw-registration.ts` — registration, already correctly inert in dev via `$app/environment`'s `dev`.
- `app/src/routes/offline/+page.svelte` — the route to retire.
- `app/e2e/picker-and-data-page.spec.ts` — prior art for the Playwright spec (helper style, `page.goto`, role-based locators).
- `app/playwright.config.ts` — already runs `bun run build && vite preview` on port 4173, so e2e exercises the same artifact GitHub Pages serves.
- Run `pnpm build` and inspect `build/` to see the real manifest shape before writing `partitionPrecache`. There is exactly one HTML file; `_app/immutable/` holds ~100 files.

## Contract

New module `offline-cache-policy` in the client library, beside `capabilities`. **It must not import or reference `caches`, `fetch`, `self`, or any service worker global.** It takes plain data and returns plain data.

```ts
type CacheTier = 'shell' | 'routes' | 'corpus';

interface PrecacheManifest {
  build: string[];
  files: string[];
  prerendered: string[];
  base: string;
  version: string;
}

partitionPrecache(manifest: PrecacheManifest): Record<CacheTier, string[]>;

type RequestDisposition = 'navigation' | 'asset' | 'bypass';

classifyRequest(
  url: URL,
  origin: string,
  destination: string,
  manifest: PrecacheManifest
): RequestDisposition;

cachesToRetain(existingCacheNames: string[], version: string): string[];
```

Tier assignment:

- **shell** — the SPA fallback HTML, the web app manifest, the SvelteKit entry and start chunks, the route nodes for the root layout and the error page, and the root stylesheet. Identify these by **pattern** against the `build` array (e.g. `_app/immutable/entry/start.*`, `entry/app.*`, `nodes/0.*`, `nodes/1.*`, `assets/0.*.css`) — never by hardcoded content hashes, which change every build.
- **routes** — every remaining entry in `build`.
- **corpus** — every entry in `files`.

The partition must be exhaustive and disjoint: every manifest entry lands in exactly one tier, none is dropped or duplicated.

Cache names are version-scoped **per tier** so tiers can be evicted independently and the corpus can survive a version change later. Pick a stable scheme such as `apato-<tier>-<version>`; `cachesToRetain` depends on being able to parse tier and version back out of a cache name.

Fetch handling in the adapter:

- `navigation` → serve the cached shell HTML, cache-first, revalidating in the background. Never key the shell on the request URL — one shell entry serves all routes.
- `asset` → the existing cache-first-with-background-update behavior, unchanged.
- `bypass` → do not call `event.respondWith` at all.

`classifyRequest` returns `bypass` for: cross-origin URLs, `/@vite` and `/@fs/` paths, and `worker` / `sharedworker` / `serviceworker` destinations. Non-GET requests are filtered by the adapter before the policy module is consulted.

**The shell must be fetched and stored explicitly during install, and stored regardless of its HTTP status.** Use `fetch()` + `cache.put()`, not `cache.add()`. This is the crux of the bug: the fallback legitimately arrives with a 404 status on GitHub Pages, and that is a property of the hosting, not an error to be handled. A shell fetch that fails at the *network* level should still fail install loudly rather than being swallowed by a warning.

## Out of scope

- Moving the routes tier to a background warm. It stays in `install` in this slice. That is ticket 02, and doing it here will make this slice unreviewable.
- Any warm progress messaging, `postMessage` protocol, or `shouldWarm` gating. Tickets 02 and 03.
- Precaching `files` / the IGNTP corpus. Ticket 04.
- Changing `skipWaiting()` or the activate-time cache deletion beyond wiring in `cachesToRetain`. Ticket 05 owns update behavior — keep the current eager takeover for now.
- Prerendering routes to real HTML. The SPA-with-fallback shape is deliberate; do not add `export const prerender = true` anywhere.
- Caching cross-origin IIIF imagery.
- Touching OPFS, the local database, or anything under `src/lib/client/db` or `src/lib/client/sync`. The offline cache is Cache Storage only and must never be able to endanger project data.

## Acceptance criteria

- [ ] A new `offline-cache-policy` module exists in the client library with `partitionPrecache`, `classifyRequest`, and `cachesToRetain`, and imports no service worker globals.
- [ ] Node vitest specs cover: exhaustive and disjoint partitioning of a realistic manifest; shell tier contains entry, start, node 0, node 1, root CSS, fallback HTML, and web app manifest; `classifyRequest` returns `navigation` / `asset` / `bypass` for the cases named in the Contract; `cachesToRetain` keeps the current version's caches and drops older unreferenced ones.
- [ ] The service worker contains no tier-assignment or request-classification logic of its own — it delegates to the policy module.
- [ ] The `/offline` route is deleted and nothing references it.
- [ ] A Playwright spec loads the app, goes offline via `context.setOffline(true)`, reloads, and asserts the application shell renders.
- [ ] The same spec, still offline, navigates to a route never visited in that session and asserts it renders.
- [ ] The same spec asserts no plain-text service-unavailable response appears during an offline boot.
- [ ] `pnpm lint`, `pnpm check`, and the full test suite pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm exec playwright test e2e/offline-capability.spec.ts
pnpm lint
pnpm check
```

Success: the vitest server project reports the new policy specs passing; the Playwright spec passes against the built preview; lint and check report no errors.

To verify by hand: `pnpm run preview`, load `http://localhost:4173`, then in DevTools set Network to Offline and reload. Before this ticket you get the bare text `Offline`; after it you get the application.

## Blocked by

None - can start immediately.
