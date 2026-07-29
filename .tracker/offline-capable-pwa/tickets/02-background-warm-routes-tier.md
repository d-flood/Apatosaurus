# 02 — Background warm of the routes tier

## Parent

`.tracker/offline-capable-pwa/SPEC.md`

## What to build

After ticket 01, the app boots offline but still blocks service worker installation on roughly 9 MB of route chunks, competing with first paint on a first visit. This slice moves the **routes tier** out of `install` and into a throttled background warm driven from the page, so that a scholar who lingers on the first page for a minute quietly becomes fully offline-capable without ever asking, and without a download holding up the app.

The page requests the warm over `postMessage` from an idle callback after mount; the service worker performs it with a small number of concurrent fetches and reports progress back to all clients. The warm is idempotent and resumable — it skips URLs already in the tier cache, so an interrupted visit is completed by the next one. It declines politely on metered or slow connections and when storage headroom is short, reporting a reason rather than failing.

A partial warm must still leave the app bootable offline. The shell tier stays exactly where ticket 01 put it: blocking, at install.

## Where to start

- The `offline-cache-policy` module from ticket 01 — add `shouldWarm` and the warm-state types here. The tier partitioning it already produces is the input to the warm.
- The service worker adapter from ticket 01 — the `install` handler currently precaches shell **and** routes; routes move out.
- `app/src/routes/+layout.svelte` — `onMount` already calls `registerServiceWorker()`. The warm request is triggered from here, on an idle callback, after the existing initialization.
- `app/src/lib/client/sw-registration.ts` — extend with the client half of the message protocol. It already handles registration and `updatefound`.
- `app/src/lib/client/capabilities.ts` — `getStorageEstimate` already exists and returns `{ usage, quota, usageRatio, isNearQuota }`. Reuse it for the headroom check rather than calling `navigator.storage.estimate()` again.
- `app/src/lib/client/network-status.svelte.ts` — existing online/offline state, for reference on how ambient browser state is modelled in this codebase.

## Contract

Added to `offline-cache-policy`:

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

interface WarmConditions {
  saveData: boolean;
  effectiveType: string | null;
  estimate: { usage: number | null; quota: number | null };
  tier: CacheTier;
}

shouldWarm(conditions: WarmConditions): boolean;
```

`shouldWarm` returns false under `saveData`, on a slow `effectiveType` (`slow-2g`, `2g`), and without sufficient quota headroom. **It never declines the shell tier** — the shell is not optional. A declined warm reports `state: 'skipped'` with the reason; it is not an error.

Message protocol between page and worker. Keep it minimal; other slices depend on these as *behavior*, not as literal payloads:

- Page → worker: a request to warm a named tier.
- Worker → all clients: `WarmProgress` updates during the warm, and a terminal update carrying `ready`, `partial`, `skipped`, or `failed`.

Warm execution rules:

- Bounded concurrency — a small fixed number of parallel fetches (4–6). Do not issue ~100 requests at once; it starves the requests the scholar's actual work depends on.
- Idempotent and resumable — check the tier cache first and skip entries already present. A second warm on a fully warmed tier completes immediately and reports `ready`.
- Never inside `install`'s or `activate`'s `waitUntil`. Activation must stay fast.
- Individual fetch failures do not abort the warm. Finish the rest, then report `partial`.

## Out of scope

- Any UI. Nothing visible changes for the scholar in this slice; the warm is observable only through DevTools and the message protocol. The Data & Storage panel is ticket 03.
- The corpus tier. `shouldWarm` should handle it correctly by type, but nothing may trigger a corpus warm yet — that is ticket 04.
- Changing update or `skipWaiting` behavior. Ticket 05.
- Retry UI or automatic retry loops. A failed warm reports `failed` and is retried on the next visit by the ordinary idle-callback path; do not build a backoff scheduler.
- Persisting warm state to localStorage or the database. It is derived state — recompute it from cache contents.

## Acceptance criteria

- [ ] The routes tier is no longer fetched during `install`; only the shell tier is.
- [ ] Node vitest specs cover `shouldWarm`: declines on `saveData`, declines on `slow-2g` / `2g`, declines without quota headroom, permits on an ordinary connection, and never declines the shell tier.
- [ ] The warm is triggered from the page on an idle callback after mount, not from `install` or `activate`.
- [ ] The warm skips entries already present in the tier cache — running it twice does not refetch.
- [ ] A fetch failure mid-warm does not abort the remaining entries, and the terminal report is `partial`.
- [ ] The Playwright offline spec from ticket 01 still passes: it waits for the warm to report ready before going offline, and an unvisited route still renders offline.
- [ ] `pnpm lint`, `pnpm check`, and the full test suite pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run --project server
pnpm exec playwright test e2e/offline-capability.spec.ts
pnpm lint
pnpm check
```

Success: the vitest server project reports the `shouldWarm` specs passing; the Playwright spec passes with the warm-ready wait in place.

To verify by hand: `pnpm run preview`, load the app with DevTools open on the Network tab, and confirm the service worker installs promptly while route chunks stream in afterwards rather than before first paint. Application → Cache Storage shows the routes tier filling up over a few seconds.

## Blocked by

- 01 — needs the `offline-cache-policy` module and the tier partitioning it produces.
