# Contributing to Apatopwa App

## Setup

1. Clone the full repository. The app currently depends on sibling packages in this monorepo.
2. Install dependencies with `bun install`.
3. Install Playwright browsers if needed:

```sh
bunx playwright install --with-deps chromium
```

## Before Opening a PR

Run the app quality gates from `app/`:

```sh
bun run lint
bun run check
bun run test:unit -- --run
bun run build
bun run test:e2e
```

## Scope and Style

- Prefer small focused changes.
- Keep incomplete product work clearly marked as work in progress.
- Do not introduce machine-specific paths or hostnames.
- Update `.env.example` and docs whenever runtime requirements change.

## Notes

- Authentication routes are currently stubs.
- A project license has not been finalized yet.
