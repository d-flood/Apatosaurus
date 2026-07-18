# 04 — Picker + Data & Storage page (contract)

## What to build

The *contract* half of the mega-page expand–contract, done as one slice so no panel needs a temporary home. `/projects` slims to a calm picker — project cards, create form, zip import, nothing else. A new `/data` page (glossary: *Data & Storage page*) receives every app-wide storage and data-safety tool. Demo: the picker shows only cards/create/import; every tool that vanished from it works on `/data`; each project card opens its transcriptions section.

## Where to start

- Everything moves out of `app/src/routes/projects/+page.svelte`. After slice 02 took the tabbed sections, what remains maps as:
  - **Stays (picker):** Project Library card — cards get name, description, one sync badge (`projectBackupSummaries` / `deriveProjectBackupSummary` from `app/src/lib/client/db/client.ts`), Open link; the create form; `ProjectZipImportPanel` (zip import creates a project, so it belongs with creation).
  - **Moves to `/data`:** Local Storage stat grid, Storage Durability panel, durability warning, near-quota warning, Whole-Account Export (`exportAllProjectsZip`), Repair Database + `IndexRepairReport` (`rebuildLocalIndex`, `restoreOrphanPrimary`), persistent-storage request, and `OnboardingGuidance` in its full form.
  - **Dies:** the `Current Project` panel, section tabs, and all `activeSection` / `readInitialProjectSection` / `selectSection` hash machinery (the sections now live under `projects/[id]/`).
- Capability helpers for `/data`: `app/src/lib/client/capabilities.ts` (`checkStoragePersistence`, `getStorageEstimate`, `shouldShowDurabilityWarning`, …).

## Contract

- Picker renders only: heading, project cards, create form, zip import, "No projects yet" empty state with the create form. Zero storage plumbing.
- Creating or importing a project navigates into `projects/{newId}/transcriptions`.
- `/data` holds app-wide state only, plus a per-project backup *status list* (name + sync badge) where each row links to `projects/{id}/backup`. **No backup mutation controls on `/data`** — controls live only on the per-project backup page.
- `/data` is the future click-through target of the navbar sync badge (wired in slice 05) and of dashboard attention items (slice 08) — its route path is part of this contract.

## Out of scope

- Navbar (still shows old links until slice 05); legacy redirects; the `(library)` dead code.
- Internals of `ProjectZipImportPanel`, `IndexRepairReport`, `OnboardingGuidance` (the compressed onboarding variant is slice 08).
- Sync-engine and capability-detection logic.

## Acceptance criteria

- [ ] `/projects` contains no storage/durability/export/repair UI (assertion in the retargeted mega-page specs — update `app/src/routes/page.svelte.spec.ts` and any spec referencing the removed panels *by name*; retarget, don't delete).
- [ ] Create project → land on its transcriptions section; import zip → project card appears (e2e).
- [ ] On `/data`: whole-account export triggers a download, Repair Database runs and renders its report, the per-project list links to each project's backup page (e2e).
- [ ] `grep -rn "activeSection" app/src/routes/projects` returns nothing.
- [ ] `cd app && bun run check && bun run test:unit -- --run && bun run test:e2e` passes.

Commands (run from `app/`): `bun run check`, `bun run test:unit -- --run`, `bun run test:e2e`, plus the grep above. Success = all exit 0, grep empty.

## Blocked by

- 02 — project workspace routes (sections must exist before the mega-page loses its tabs).
