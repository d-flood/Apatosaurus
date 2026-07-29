# Tiered Offline Caching for the Installed and Browser App

## Problem Statement

Apatosaurus presents itself as an offline-first manuscript transcription and collation tool. It has a manifest, an icon set, PWA meta tags, and a registered service worker — so a scholar can install it and reasonably expect it to work on a plane, in a manuscript reading room with no signal, or in a library basement. It does not.

The app is deployed to GitHub Pages as a pure SPA: nothing is prerendered, so the build emits exactly one HTML file — the adapter-static fallback — served with an HTTP 404 status. The service worker's precache list asks for the site root and an offline route, and `cache.add()` rejects on any non-2xx response, so both fail and are swallowed by a console warning. The navigation handler only writes to the cache when the network response is `ok`, and a 404-status fallback never is. The result is that **no HTML shell ever enters the cache**. Every route's JavaScript is cached correctly, and none of it can run, because an offline reload walks the whole fallback chain and lands on a plain-text `503 Offline` response. A scholar who installs the app, closes the laptop, and reopens it without network sees that bare text instead of their work.

Three further gaps compound it. The `static/` payload — 44 MB, of which 38 MB is the IGNTP reference corpus and 5.8 MB is fonts — is never precached, only cached opportunistically after a request. The precache that does happen is all-or-nothing and blocks service worker installation on roughly 9 MB of route chunks, competing with first paint on the very first visit. And activation calls `skipWaiting()` and then deletes every cache from the previous version, so a tab still running the old build loses the chunks it has not yet lazily imported.

Underneath all of this is a shape problem: a scholar should not have to *choose* between "download the whole application now" and "have nothing offline." The desirable behavior — linger on the first page for a minute and quietly become fully offline-capable — is not available at any setting today.

## Solution

Rework the service worker into a **tiered cache warm**, and make the shell the thing that is guaranteed.

A tiny, blocking **Tier 0** precache — the SPA shell HTML, the manifest, the app entry and start chunks, the root layout and error nodes, and the root stylesheet — installs in a blink and is what makes the app boot at all with no network. Because there is no per-URL HTML in a static SPA build, the shell is served for *every* navigation, cache-first, with a background revalidate. That single change both fixes offline entirely and makes warm navigations instant.

**Tier 1** — the remaining route chunks, which is to say the code for pages the scholar has never visited — is fetched in the background after activation, throttled, driven from an idle callback in the page rather than from the install event, so it never competes with first paint. A scholar who lingers on the dashboard for a minute ends up with the entire application offline-capable without ever having asked for it, and without a progress bar holding them hostage. This applies identically to the browser tab and the installed app: service worker behavior does not depend on installation, so a first-time visitor who reads the About page gets the same benefit.

**Tier 2** — the 38 MB IGNTP corpus and other large static assets — is opt-in. Downloading that unasked is rude on a metered connection and will hit the storage quota on iOS. It becomes an explicit control on the **Data & Storage page**, the app's established single destination for storage durability and break-glass tooling, with a size estimate up front and progress while it runs.

Cache warm state — idle, warming, ready, partial, failed — is reported back to the page so the scholar can see, on the Data & Storage page, whether the app is actually ready to go offline. Updates stop being destructive: entries still referenced by the new build are carried forward rather than the old cache being deleted wholesale.

## User Stories

### Booting with no network

1. As a scholar who installed the app, I want to open it with no network connection and see the application, so that "offline-first" is true rather than aspirational.
2. As a scholar, I want to reload the page while offline and land back on the app rather than a plain-text error, so that a stray refresh does not end my working session.
3. As a scholar working offline, I want to navigate to a route I have never visited before and have it render, so that being offline does not shrink the app to the pages I happened to open earlier.
4. As a scholar, I want a deep link or bookmark to a project or document page to work offline, so that my saved entry points remain usable.
5. As a scholar, I want the app to boot offline whether I installed it or am just using a browser tab, so that I am not forced to install to get durability.
6. As a scholar, I want fonts and icons to be present offline, so that the app does not degrade into unstyled fallback type when I lose signal.
7. As a scholar, I want an offline boot to be fast, so that the cached path feels better than the network path rather than merely equal to it.

### Becoming offline-capable in the background

8. As a first-time visitor, I want the app to become fully offline-capable while I read the first page, so that I gain durability without deciding anything.
9. As a first-time visitor, I want that background warm never to delay the first paint or make the page feel sluggish, so that the cost of durability is invisible.
10. As a scholar on a metered or slow connection, I want the background warm to be skipped, so that the app does not silently consume my data allowance.
11. As a scholar near my storage quota, I want the background warm to be skipped rather than failing noisily, so that a full disk does not turn into a stream of errors.
12. As a scholar, I want the background warm to resume on a later visit if it was interrupted, so that a closed tab does not permanently leave me half-cached.
13. As a scholar, I want a partial warm to still leave the app bootable offline, so that an interrupted download degrades to "shell works, some pages need network" rather than to nothing.
14. As a scholar, I want the background warm to be throttled rather than issuing a hundred parallel requests, so that it does not starve the requests my actual work depends on.

### Seeing and controlling offline readiness

15. As a scholar, I want the Data & Storage page to tell me whether the app is ready to work offline, so that I can find out before I lose signal rather than after.
16. As a scholar, I want that readiness display to distinguish "shell only," "fully warmed," and "warming now," so that I know what will and will not work if I disconnect.
17. As a scholar about to travel, I want to trigger the full warm immediately rather than waiting for the background pass, so that I can prepare deliberately.
18. As a scholar, I want to see progress while a warm is running, so that I know whether to wait.
19. As a collator who works with the IGNTP reference corpus, I want to opt into caching it for offline use, so that reference editions are available in a reading room with no signal.
20. As a scholar, I want to be told roughly how large the reference corpus download is before I start it, so that I can decide on a metered connection.
21. As a scholar, I want to see how much space the offline caches occupy, so that I can reason about the app's footprint alongside my project data.
22. As a scholar, I want to release the cached reference corpus without uninstalling the app or clearing my project data, so that reclaiming space is not destructive.
23. As a scholar whose corpus download failed partway, I want to be told and offered a retry, so that a flaky connection does not leave me silently unprepared.
24. As a scholar, I want offline readiness surfaced on the Data & Storage page rather than interrupting my work, so that plumbing stays off my daily path.
25. As a scholar with a genuine problem — warm failed, quota exceeded — I want it raised as an attention item, so that the one case that matters does reach me.

### Updates and version transitions

26. As a scholar with the app open when a new version deploys, I want my current session to keep working, so that a deploy does not break the page I am typing into.
27. As a scholar, I want a lazily loaded page to still load after a new version is deployed mid-session, so that navigating does not produce a chunk-loading error.
28. As a scholar, I want a newly deployed version to be warmed in the background too, so that I do not silently fall back to shell-only offline capability after every deploy.
29. As a scholar, I want stale caches from old versions cleaned up once they are genuinely unreferenced, so that the footprint does not grow without bound across deploys.
30. As a scholar, I want my opted-in reference corpus to survive an app update, so that I do not re-download 38 MB on every deploy.
31. As a scholar, I want to be able to pick up a new version without hunting for a hard-refresh incantation, so that updating is ordinary.

### Data safety boundaries

32. As a scholar, I want the offline cache to be strictly separate from my project data, so that clearing or rebuilding the cache can never destroy work.
33. As a scholar, I want non-GET requests never intercepted or cached, so that the cache layer cannot interfere with writes.
34. As a scholar, I want cross-origin requests — IIIF image servers in particular — left alone by default, so that the cache does not accumulate unbounded remote imagery.
35. As a developer, I want the service worker inert in development, so that stale caches never confuse local work.

## Implementation Decisions

### Where the decisions live

Every caching *decision* moves into a new pure module, `offline-cache-policy`, in the client library alongside `capabilities`. It has no dependency on `caches`, `fetch`, `self`, or any service worker global — it takes plain data and returns plain data. The service worker file becomes a thin adapter: it reads `build`, `files`, `prerendered`, and `version` from `$service-worker`, asks the policy module what to do, and performs the I/O.

The policy module's surface, expressed as types:

```ts
type CacheTier = 'shell' | 'routes' | 'corpus';

interface PrecacheManifest {
  build: string[];
  files: string[];
  prerendered: string[];
  base: string;
  version: string;
}

// Partitions the SvelteKit manifest into the three tiers.
partitionPrecache(manifest: PrecacheManifest): Record<CacheTier, string[]>;

type RequestDisposition = 'navigation' | 'asset' | 'bypass';

// Decides how a GET request should be handled, given the manifest.
classifyRequest(url: URL, origin: string, destination: string, manifest: PrecacheManifest): RequestDisposition;

// Which cache names survive activation of `version`.
cachesToRetain(existingCacheNames: string[], version: string): string[];

interface WarmConditions {
  saveData: boolean;
  effectiveType: string | null;
  estimate: { usage: number | null; quota: number | null };
  tier: CacheTier;
}

shouldWarm(conditions: WarmConditions): boolean;
```

### Tier assignment

- **Shell (Tier 0, blocking install, target well under 500 KB):** the SPA fallback HTML, the web app manifest, the SvelteKit entry and start chunks, the route nodes for the root layout and the error page, and the root stylesheet. Identified by pattern against the `build` manifest rather than hardcoded hashed filenames.
- **Routes (Tier 1, background):** everything else in `build` — all remaining route nodes, chunks, CSS, and hashed assets. Roughly 100 files, ~9 MB.
- **Corpus (Tier 2, opt-in):** everything in `files`, dominated by the IGNTP reference corpus. Never fetched without an explicit request from the page.

Each tier gets its own version-scoped cache name, so a tier can be evicted or retained independently — in particular so the opted-in corpus survives version changes.

### Navigation handling

The build produces no per-URL HTML. Therefore **all navigation requests are served from the cached shell**, cache-first with a background revalidate; the SvelteKit client router resolves the actual route. This replaces today's network-first-per-URL strategy, which cannot work against a fallback served with a 404 status. Consequently the app must no longer depend on `response.ok` to decide whether the shell is cacheable — the shell is fetched and stored explicitly at install, not opportunistically from navigation traffic.

The dedicated `/offline` route becomes unnecessary once the shell always renders, and it is retired rather than kept as a second, worse shell.

### Warm orchestration

The background warm is **driven from the page, not from the install or activate event**. The page requests it over `postMessage` from an idle callback after mount; the service worker performs it, bounded to a small number of concurrent fetches, reporting progress back to all clients. This keeps activation fast and keeps the warm off the critical path for first paint. The warm is idempotent and resumable: it skips URLs already present in the tier cache, so a subsequent visit completes what an interrupted one started.

Warm state reported to clients:

```ts
type WarmState = 'idle' | 'warming' | 'ready' | 'partial' | 'skipped' | 'failed';

interface WarmProgress {
  tier: CacheTier;
  state: WarmState;
  completed: number;
  total: number;
  bytesCached: number | null;
  reason?: 'save-data' | 'slow-network' | 'quota' | 'network-error';
}
```

`shouldWarm` consults `navigator.connection.saveData` and `effectiveType` and a `navigator.storage.estimate()` headroom check; a declined warm reports `skipped` with a reason rather than failing.

### Update behavior

Unconditional `skipWaiting()` is dropped. A new worker installs and waits; it takes over when the client says to, or when no clients remain. Activation retains, rather than deletes, any cache still referenced by the incoming version — and always retains the corpus tier across versions. Cleanup removes only genuinely unreferenced caches. The page is told when an update is ready so it can offer a reload.

### Request boundaries

Unchanged and reaffirmed: non-GET requests, cross-origin requests, Vite dev endpoints, and worker/sharedworker/serviceworker destinations are all bypassed. Cross-origin IIIF imagery stays outside the cache. The offline caches are the Cache Storage API only and never touch OPFS or the local database, so cache operations cannot endanger project data. The worker stays unregistered in development.

### UI surface

Offline readiness lives on the **Data & Storage page**, beside storage durability and persistence, consistent with that page's established role as the single destination for storage concerns. It shows warm state per tier, a "prepare for offline now" action, an opt-in toggle with a size estimate for the reference corpus, cached-size reporting, and a release action for the corpus. Only genuine problems — a failed warm, an exceeded quota — surface as attention items on the dashboard.

## Testing Decisions

A good test here asserts behavior a scholar could observe: that the app boots with the network off, that an unvisited route renders, that a metered connection is left alone. It does not assert which cache name was chosen, how many `fetch` calls were made, or the shape of an internal message. Cache *policy* is deterministic data-in/data-out and is tested as such; cache *effect* is tested once, for real, through the browser.

**Seam 1 — the `offline-cache-policy` module, node vitest.** The primary seam. Every decision-rich behavior is reachable here as a pure function, with no service worker globals and no fake `caches` implementation. Prior art is `capabilities.spec.ts`, which tests an equally environment-adjacent module by stubbing globals and asserting returned reports. Coverage:

- `partitionPrecache` puts entry, start, root node, and root stylesheet in the shell tier; puts every other `build` entry in the routes tier; puts `files` in the corpus tier; produces a shell tier small enough to justify blocking install; and partitions a realistic manifest exhaustively, with no entry lost or duplicated across tiers.
- `classifyRequest` returns `navigation` for navigation requests, `asset` for same-origin build and static assets, and `bypass` for cross-origin URLs, Vite dev paths, and worker destinations.
- `cachesToRetain` keeps the incoming version's caches, keeps the corpus tier across a version change, and drops unreferenced older caches.
- `shouldWarm` declines under `saveData`, declines on a slow `effectiveType`, declines without quota headroom, and permits on an ordinary connection — and never declines the shell tier.

**Seam 2 — one Playwright spec, against the real built output.** The only place a real service worker runs, since registration is disabled in development; the Playwright config already builds and previews the app, so the spec exercises the same artifact GitHub Pages serves. Prior art is the existing e2e specs in `e2e/`. One spec, covering the behavior that is broken today and cannot be proven any other way:

- Load the app, wait for the warm to report ready, then `context.setOffline(true)`; reload and assert the application shell renders rather than an error.
- While still offline, navigate to a route never visited in that session and assert it renders.
- Assert an offline boot does not surface a plain-text service-unavailable response anywhere.

Deliberately not tested: the service worker's internal messaging protocol, exact cache names, byte-level size accounting, and the throttling concurrency figure. These are implementation choices that should be free to change without a test edit.

## Out of Scope

- Caching cross-origin IIIF image tiles or manifests. Manuscript imagery is unbounded, remote, and belongs to a separate decision about reading-room preparation.
- Any change to how project data is stored, synced, or backed up. The offline cache is strictly the application's own code and assets.
- Prerendering routes to real HTML files. The SPA-with-fallback shape is retained; the shell strategy is what makes it work offline.
- Background Sync or Periodic Background Sync for deferred writes.
- Push notifications.
- Selective per-project or per-document offline preparation ("make this project available offline"), which is a data-layer concern rather than an asset-caching one.
- Migrating off GitHub Pages or introducing a server able to serve the shell with a 200 status.

## Further Notes

The current failure is silent by construction: the precache failures log a warning and continue, and the app works perfectly whenever the network is up, so nothing surfaces the defect during ordinary development. The Playwright offline spec is therefore load-bearing beyond its assertions — it is the thing that would have caught this, and it should be treated as a regression guard rather than as coverage for its own sake.

Deployment context matters to the shell decision. On GitHub Pages the fallback is served with an HTTP 404 status, which is why any strategy keyed on `response.ok` cannot cache it. This is a property of the hosting, not a bug to be fixed in the worker, and the design accommodates it rather than fighting it.

Route code is already fully precached today — all ~100 chunks — so the gap is narrower than it appears from the symptom. Most of the work is redistributing an existing precache across tiers and fixing the shell, not building new caching capability.

The 38 MB reference corpus is the single largest reason the tiers exist. Without the split there are only two options, and both are bad: block install on 47 MB, or cache nothing large and leave collators without reference editions offline.
