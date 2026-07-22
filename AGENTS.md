Use uv for Python commands and pnpm for JavaScript commands.

When adding a new dependency import in `app/` (including a new `phosphor-svelte/lib/*` icon), add it to `optimizeDeps.include` in `app/vite.config.ts` — undeclared deps are discovered mid-run and cause flaky "Failed to fetch dynamically imported module" errors in browser tests.

## Agent skills

### Ticket tracker

Tickets live as markdown files under `.tracker/` in this repo. See `docs/agents/ticket-tracker.md`.

### Triage labels

Five canonical triage states: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
