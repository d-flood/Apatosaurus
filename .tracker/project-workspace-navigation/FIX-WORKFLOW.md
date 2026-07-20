# Fix workflow — post-review remediation

Remediates the review findings on the project-workspace-navigation epic (review of `2d76d01...HEAD`, 2026-07-19). Executed by **Opus subagents** (`subagent_type: general-purpose` with `model: opus` — never `fork`, which inherits the orchestrator's model). Each step's prompt is self-contained: subagents start cold with no conversation context.

Orchestration rules:

- Steps run in the order listed; a step starts only when its `Needs` artifacts exist.
- Every subagent works in the repo at `/home/dflood/repos/Apatosaurus`, uses `bun` (never npm), and runs commands from `app/`.
- A step is done only when its Done criteria pass; the orchestrator verifies them itself rather than trusting the subagent's report.
- Artifacts land in `.tracker/project-workspace-navigation/remediation/`.

---

## Step 0 — Record the fence sign-offs (orchestrator, no subagent)

Append to ticket 04: "Sign-off 2026-07-19: the `onImported` prop added to `ProjectZipImportPanel` is accepted as the minimal implementation of the 'importing navigates into the new project' contract; fence amended accordingly."
Append to ticket 08: "Sign-off 2026-07-19: removing eager Default creation from the dev Reset-DB handler is accepted as consistent with the authorized lazy-Default deviation."

**Done:** both ticket files contain the sign-off lines.

## Step 1 — Diagnose the e2e race (Opus subagent, read-mostly)

**Needs:** nothing. **Produces:** `remediation/DIAGNOSIS.md`.

Prompt for the subagent:

> Repo: /home/dflood/repos/Apatosaurus (SvelteKit local-first PWA; app code in app/; use bun, run commands from app/). You are diagnosing a suspected write-then-navigate race. Do NOT fix anything in app source — your deliverable is a diagnosis document.
>
> Symptoms (from `bun run test:e2e`, suite `e2e/dashboard.spec.ts`):
> 1. "Continue resumes a collation at its current phase" — dashboard Continue linked to /collation/{id} resolved to the `setup` phase although the test had advanced the workflow to `alignment`.
> 2. On an isolated re-run, a different step failed earlier: after creating a project, the URL never matched /projects/{id}/transcriptions ("Project URL did not identify Dashboard Romans").
> Failing at two different steps across runs suggests a shared race, likely between SQLite-worker writes and SvelteKit navigation.
>
> Method: read e2e/dashboard.spec.ts; trace the collation phase-resolution path (routes/collation/[id] loader and whatever resolves workflow phase) and the post-create navigation path (project create → goto). Look for navigation issued before the worker write is awaited/flushed, and for stale reads through the db invalidation/subscription layer (lib/client/db/client.ts, db.worker.ts). Reproduce: run `bun run test:e2e -- dashboard.spec.ts` up to 5 times; record pass/fail per run and which step failed. Instrument with temporary logging if needed (revert instrumentation before finishing).
>
> Deliverable: write .tracker/project-workspace-navigation/remediation/DIAGNOSIS.md containing: (a) the root cause, stated as a specific ordering of events with file/function references; (b) evidence (repro counts, log excerpts); (c) the minimal fix you recommend and every call site it touches; (d) explicitly whether symptoms 1 and 2 share the cause, with evidence. If you cannot reproduce in 5 runs, say so and analyze statically — do not guess silently.

**Done:** `DIAGNOSIS.md` exists, names a root cause with file references, and states whether the two symptoms share it. Orchestrator sanity-checks the claimed cause against the cited code before proceeding.

## Step 2 — Fix the race (Opus subagent, blocked by Step 1)

**Needs:** `DIAGNOSIS.md`. **Produces:** the fix commit, `remediation/FIX-NOTES.md`.

Prompt for the subagent:

> Repo: /home/dflood/repos/Apatosaurus (bun, commands from app/). Read .tracker/project-workspace-navigation/remediation/DIAGNOSIS.md and implement exactly the minimal fix it recommends — if you disagree with the diagnosis, stop and write your objection to remediation/FIX-NOTES.md instead of improvising a different fix.
>
> Fences: no changes to canonical file formats, sync engine semantics, or `ensureDefaultProject`; no new dependencies; if you add any `phosphor-svelte/lib/*` import, add it to `optimizeDeps.include` in app/vite.config.ts. Fix the cause, not the test — you may strengthen the e2e test's waits only if DIAGNOSIS.md identifies the test itself as racing ahead of legitimately-completed app behavior, and must justify this in FIX-NOTES.md.
>
> Verification (all from app/): `bun run check`; `bun run test:unit -- --run`; then `bun run test:e2e -- dashboard.spec.ts` 5 consecutive times — all 5 must pass; then one full `bun run test:e2e`. Record results in remediation/FIX-NOTES.md. Commit the fix (message: what raced and how the fix serializes it, ending with the epic's session trailer convention used on this branch).

**Done:** dashboard e2e passes 5/5, full suite passes, commit exists, FIX-NOTES.md records the runs.

## Step 3 — Post-review cleanups (Opus subagent, blocked by Step 2)

**Needs:** Step 2 committed (avoids rebasing cleanup over the fix). **Produces:** one cleanup commit.

Prompt for the subagent:

> Repo: /home/dflood/repos/Apatosaurus (bun, commands from app/). Two mechanical cleanups from code review — nothing else:
>
> 1. Consolidate the creation-preselection fallback. Three surfaces inline the same chain (`queryProjectId || resolveLastOpenedProjectId(readLastOpenedProjectId(), projects) || defaultProjectId`): TranscriptionForm.svelte, routes/collation/new/+page.svelte, and the IGNTP import page. Export one helper from lib/client/navigation/last-opened-project.ts (e.g. `resolveCreationTargetProjectId(queryProjectId, projects, defaultProjectId)`) and call it from all three. The module's contract: every consumer calls through it; none reimplements the chain.
> 2. Glossary renames (CONTEXT.md is the authority — "current project" is a forbidden term): rename `currentProject` → `openProject` in routes/projects/[id]/settings/+page.svelte and `currentProjectSection` → `openProjectSection` in Navbar.svelte; rename the dashboard's `targetProject` to reflect that it is the resolved last-opened project. Where the navbar shows the last-opened project on non-project pages, the name must say `lastOpened…`, not `open…` — that distinction is ADR-0001's core rule (docs/adr/0001-url-scoped-project-navigation.md).
>
> Do NOT: extract the section-list parsing, inline the one-line builder functions, bundle the (storedId, projects) params, or touch the legacy-redirect loaders — reviewed and deliberately left alone. No behavior changes; renames and the one helper only.
>
> Verify from app/: `bun run check && bun run test:unit -- --run && bun run test:e2e -- dashboard.spec.ts`. Commit as one commit.

**Done:** grep shows no `currentProject` in app/src, the three surfaces call the helper, checks pass, one commit.

## Step 4 — Re-verify and close (orchestrator + Opus subagent)

**Needs:** Steps 0–3. **Produces:** `remediation/VERIFICATION.md`; tracker update.

Subagent prompt:

> Repo: /home/dflood/repos/Apatosaurus (bun, from app/). Run the epic's full verification: `bun run check`, `bun run test:unit -- --run`, `bun run test:e2e`, and from the repo root: `grep -rn "activeSection" app/src/routes/projects` (must be empty), `grep -rn "projects#" app/src` (must be empty), `grep -rn "currentProject" app/src` (must be empty). Write pass/fail per command with output tails to .tracker/project-workspace-navigation/remediation/VERIFICATION.md. Fix nothing — report only.

Orchestrator then: if all pass, update TRACKER.md (overall status stays `Completed`, add a "Remediation completed <date>" line) and surface VERIFICATION.md to the user. If anything fails, stop and report — do not loop back into Step 2 without human review of the new failure.
