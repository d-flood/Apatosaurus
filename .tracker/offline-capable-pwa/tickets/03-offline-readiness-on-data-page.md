# 03 — Offline readiness on the Data & Storage page

## Parent

`.tracker/offline-capable-pwa/SPEC.md`

## What to build

After ticket 02 the app warms itself in the background, but a scholar has no way to find out whether it worked — they discover it when they lose signal, which is exactly the wrong moment. This slice surfaces offline readiness on the **Data & Storage page**, the app's established single destination for storage durability and break-glass tooling.

The panel shows per-tier warm state, distinguishing "shell only" from "fully warmed" from "warming now" so the scholar knows what will and will not work if they disconnect. It offers a "prepare for offline now" action for someone about to travel who does not want to wait for the background pass, with progress while it runs. It reports how much space the offline caches occupy, alongside the existing storage figures.

Genuine problems — a failed warm, an exceeded quota — also surface as an attention item on the dashboard. Nothing else about offline readiness interrupts the scholar's work: routine state lives on the Data & Storage page and stays off the daily path.

## Where to start

- `app/src/routes/data/+page.svelte` — the Data & Storage page. Read its existing storage-durability and whole-account-export sections; the readiness panel is a sibling of those, in the same visual idiom. Note how it already consumes `checkStoragePersistence`, `getStorageEstimate`, and `formatStorageBytes` from `capabilities`.
- `app/src/routes/data/page.svelte.spec.ts` — existing component-level spec for this page.
- `app/src/lib/components/Dashboard.svelte` and `app/src/routes/+page.svelte` — `buildAttentionItems` and the `DashboardAttentionItem` type. The new attention item follows the existing backup/durability items exactly; do not invent a new attention mechanism.
- `app/src/lib/components/Dashboard.svelte.spec.ts` — prior art for asserting attention items.
- The client-side message handling added in ticket 02 — the warm progress stream is the data source for this panel.
- `formatStorageBytes` in `capabilities` — reuse it for cache sizes; do not write a second byte formatter.

## Contract

The panel reads warm state from the progress stream established in ticket 02 and derives its display from `WarmProgress`. It must render a sensible state on first paint before any progress message has arrived — treat absent state as `idle`, not as an error.

Displayed per tier:

- `idle` / `skipped` → shell-only readiness, with the skip reason in plain language when present ("skipped on a metered connection").
- `warming` → progress as completed-of-total.
- `ready` → fully warmed.
- `partial` / `failed` → problem state, with the retry path being the same "prepare for offline now" action.

Cached size is computed from Cache Storage, not tracked incrementally. It is a reported figure, not a budget to enforce.

The dashboard attention item appears **only** for `failed` and for quota-exceeded, matching the existing rule that plumbing interrupts only when it must. `skipped` on a metered connection is a normal outcome and must not raise an attention item. The item links to the Data & Storage page, consistent with every other attention item.

## Out of scope

- The corpus tier's toggle, size estimate, and release action. Ticket 04 adds those to this same panel — leave room for them but do not build them.
- Any change to warm execution, concurrency, or gating. This slice only displays what ticket 02 reports.
- Update-ready prompts. Ticket 05.
- Redesigning the Data & Storage page, the existing durability section, or the attention-item mechanism. Add alongside; do not refactor.
- A progress bar component library or any new dependency.

## Acceptance criteria

- [ ] The Data & Storage page shows an offline readiness panel with per-tier state distinguishing shell-only, warming, and fully warmed.
- [ ] The panel renders correctly before any warm progress message has arrived.
- [ ] A "prepare for offline now" action triggers the warm immediately and shows progress while it runs.
- [ ] Total offline cache size is displayed using the existing byte formatter.
- [ ] A failed warm or exceeded quota produces a dashboard attention item linking to the Data & Storage page; a warm skipped on a metered connection produces none.
- [ ] Component specs cover the state rendering and the attention-item rule.
- [ ] `pnpm lint`, `pnpm check`, and the full test suite pass.

Commands, runnable as written from `app/`:

```sh
pnpm run test:unit -- --run
pnpm exec playwright test e2e/picker-and-data-page.spec.ts
pnpm lint
pnpm check
```

Success: both vitest projects pass including the new component specs; the existing Data & Storage e2e spec still passes unchanged.

To verify by hand: `pnpm run preview`, visit `/data`, and watch the readiness panel move from warming to ready. Then clear Cache Storage in DevTools, reload, and confirm "prepare for offline now" refills it with visible progress.

## Blocked by

- 02 — needs the warm progress stream and `WarmProgress` shape.
