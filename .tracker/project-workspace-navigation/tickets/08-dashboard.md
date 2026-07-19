# 08 — Re-entry dashboard (Phase 2)

## What to build

All of Phase 2: `/` becomes the *dashboard* — the re-entry point for a scholar returning after weeks. Four sections in order: Continue where you left off, Needs attention, Start something, footer. The current brochure content moves wholesale to `/about`. Demo: with recent work, resuming a document is one click from app open; with a fresh profile, a single welcome card guides to project creation.

## Where to start

- Replace: `app/src/routes/+page.svelte` (static brochure, 42 lines). Brochure content → `app/src/routes/about/+page.svelte`.
- Continue data: `listTranscriptionSummaries` (`app/src/lib/client/db/repositories/transcriptions.ts`) and collation summaries (`app/src/lib/client/db/repositories/collations.ts`) — both already ordered by `updated_at` desc. Merge, take 5.
- Collation resume: link to `/collation/{id}` — `app/src/routes/collation/[id]` already resolves the current workflow phase.
- Attention inputs: per-project backup summaries (`deriveProjectBackupSummary` in `app/src/lib/client/db/client.ts`; statuses `pending-backup`, `blocked`, `remote-update`, `conflict`, `unavailable`), `shouldShowDurabilityWarning` and quota helpers (`app/src/lib/client/capabilities.ts`).
- Start-something targets: slice 01's resolution; button pattern precedent in the project layout header from slice 02.
- Component spec prior art: `app/src/lib/components/OnboardingGuidance.svelte.spec.ts`.

## Contract

- **Continue**: top 5 of transcriptions ∪ collations by existing `updated_at` desc, across all projects. Row: title, type, project name, commit-state badge, relative last-touched time, Open → flat document route. Hidden entirely when empty. **No new recency writes anywhere** — opening without editing does not reorder (per SPEC.md and the grill: recency = `updated_at`, period).
- **Needs attention**: rendered only when non-empty; items are project backup problems (link → that project's backup page), durability/near-quota warnings (link → `/data`), and a single compressed storage-setup card replacing `OnboardingGuidance`'s presence here (full form stays on `/data`). This is the only place plumbing interrupts unprompted.
- **Start something**: New Transcription, Import IGNTP, New Collation, each naming its target project ("New Transcription in Default") resolved via slice 01.
- **Footer**: About link, app version.
- Empty states: zero projects → single welcome card ("Create your first project" → `/projects`) and nothing else; projects but zero documents → Start something promoted to top, no Continue section.

## Out of scope

- New recency tracking or `updated_at` semantics changes.
- Notification center, theme system, `OnboardingGuidance` internals (the compressed card is new dashboard markup, not a rewrite of the component).
- Navbar (done in slice 05).

## Acceptance criteria

- [ ] Component specs (browser mode) cover: Continue empty vs populated, attention hidden when nothing is wrong, both empty states.
- [ ] E2E: Continue opens a collation at its current phase; an attention item links to `/data` or the project backup page; Start something creates into the named project; `/about` carries the former brochure content; fresh profile shows only the welcome card.
- [ ] Update `app/src/routes/page.svelte.spec.ts` (home page spec) by name — retarget, don't delete.
- [ ] Any new phosphor icon is in `optimizeDeps.include` in `app/vite.config.ts`.
- [ ] `cd app && bun run check && bun run test:unit -- --run && bun run test:e2e` passes.

Commands (run from `app/`): `bun run check`, `bun run test:unit -- --run`, `bun run test:e2e`. Success = all exit 0.

## Blocked by

- 04 — Data & Storage page (attention links).
- 05 — navigation cutover (navbar/footer coherence; About no longer in navbar).

## Implementation note

2026-07-19: Browser verification found that the required fresh-profile state cannot occur with the current bootstrap behavior. A newly created index calls `rebuildIndex()`, which calls `ensureDefaultProject()` in `app/src/lib/client/db/db.worker.ts:746-750`, so `/` sees an empty Default project rather than zero projects. Rendering the first-project welcome card for that state would contradict the separate "projects but zero documents" contract; removing the startup bootstrap would contradict ticket 06's requirement that bootstrap semantics and `ensureDefaultProject` remain untouched. Human validation is needed to choose which state the dashboard should render for a pristine Default project or to authorize a bootstrap change.

Human decision: make Default lazy by removing eager worker startup creation while preserving `ensureDefaultProject` as the creation-flow fallback.
