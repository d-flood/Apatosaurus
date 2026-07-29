Use uv for Python commands and pnpm for JavaScript commands.

When adding a new dependency import in `app/` (including a new `phosphor-svelte/lib/*` icon), add it to `optimizeDeps.include` in `app/vite.config.ts` — undeclared deps are discovered mid-run and cause flaky "Failed to fetch dynamically imported module" errors in browser tests.

