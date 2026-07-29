# 04 — Opt-in reference corpus tier

## Parent

`.tracker/offline-capable-pwa/SPEC.md`

## What to build

The `static/` payload is 44 MB, of which 38 MB is the IGNTP reference corpus and 5.8 MB is fonts. A collator working in a reading room with no signal needs those reference editions; a scholar on a phone plan emphatically does not want them downloaded unasked, and on iOS the attempt will hit the storage quota. This slice makes the **corpus tier** an explicit, informed choice.

On the Data & Storage page's readiness panel, the scholar gets an opt-in control that states roughly how large the download is *before* it starts, shows progress while it runs, and can be released afterwards to reclaim space without uninstalling the app or touching project data. A download that fails partway says so and offers a retry rather than leaving the scholar silently unprepared.

The corpus tier is never fetched without an explicit request from the page. The background warm from ticket 02 must not touch it.

## Where to start

- The readiness panel added in ticket 03 — the corpus controls live in it, as a distinct opted-in section below the automatic tiers.
- The `partitionPrecache` corpus tier from ticket 01 — it already contains every entry in the SvelteKit `files` manifest. That is the download list; do not re-enumerate `static/`.
- The warm machinery from ticket 02 — corpus download reuses it. Same concurrency bound, same progress reporting, same resumability. If it needs a second implementation, something went wrong in 02; fix 02's generality instead of forking it.
- `getStorageEstimate` and `formatStorageBytes` in `app/src/lib/client/capabilities.ts` — for the headroom check and for presenting the size.
- `app/static/igntp/` — 38 MB, the bulk of the tier. `app/static/fonts/` is 5.8 MB.

## Contract

The corpus tier's cache is version-scoped like the others but **survives an app update**: ticket 05 makes `cachesToRetain` carry it across version changes so a scholar does not re-download 38 MB on every deploy. If ticket 05 has not landed when this ticket is picked up, still write the corpus cache under its own tier name so that retention becomes a `cachesToRetain` change alone.

Opt-in state must be **derived from cache contents**, not stored as a separate preference flag. A tier that is present is opted in; a released tier is not. This keeps the display honest after a browser evicts the cache under storage pressure — a scholar who thinks the corpus is cached when it is not is worse off than one who was never told.

The size estimate shown before download may be an approximate constant or computed from the manifest; it must be honest about being approximate. Check quota headroom via `getStorageEstimate` before starting and refuse with a clear message rather than starting a download that cannot finish.

The release action deletes only the corpus tier's cache. It must not touch the shell tier, the routes tier, OPFS, or the local database.

A partial download reports `partial` and offers retry; retry resumes rather than restarting, via the same skip-what-is-present rule as ticket 02.

## Out of scope

- Caching cross-origin IIIF image tiles or manifests. Explicitly out of scope for the whole epic — manuscript imagery is unbounded and remote.
- Per-project or per-document offline preparation ("make this project available offline"). That is a data-layer concern, not asset caching.
- Splitting the corpus into sub-selections (per edition, per book). One tier, one choice.
- Automatic corpus download under any condition, including "the scholar has lots of free space". It is always an explicit action.
- Changing how the IGNTP corpus is served, loaded, or parsed by the app at runtime.

## Acceptance criteria

- [ ] The Data & Storage readiness panel offers a corpus opt-in control that states the approximate download size before starting.
- [ ] The background warm never fetches corpus entries — only an explicit page action does.
- [ ] Download shows progress and reports a terminal state; a partial download offers a retry that resumes rather than restarting.
- [ ] Insufficient quota headroom refuses the download with a clear message instead of starting it.
- [ ] A release action removes the corpus cache and leaves the shell tier, routes tier, and all project data intact.
- [ ] Opt-in state is derived from cache contents — clearing the cache in DevTools makes the panel show it as not cached, with no stale preference flag.
- [ ] `pnpm lint`, `pnpm check`, and the full test suite pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run
pnpm lint
pnpm check
```

Success: both vitest projects pass including specs for the derived opt-in state and the quota refusal.

To verify by hand: `pnpm run preview`, visit `/data`, opt into the corpus, and watch Application → Cache Storage fill to roughly 44 MB. Go offline and confirm a reference edition still loads. Release it and confirm the cache is gone while projects and transcriptions are untouched.

## Blocked by

- 03 — the readiness panel these controls live in.
