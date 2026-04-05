# Apatopwa App

SvelteKit application for manuscript transcription, IIIF-assisted annotation, and collation workflows.

## Status

This app is active work in progress. The codebase is intended to be readable and contributor-friendly even where product surfaces are incomplete.

Current known gaps:

- authentication routes are UI stubs only
- the app currently lives inside this monorepo and depends on sibling packages under `../djazzkit`, `../triiiceratops`, `../collatex`, and `../packages/tei-transcription`
- a project license has not been finalized yet

## Prerequisites

- Bun 1.x
- Playwright browser dependencies for browser-based Vitest and e2e tests

## Development

Install from the repository root or from `app/` with the full monorepo checked out:

```sh
bun install
```

Start the app:

```sh
bun run dev
```

## Quality Gates

```sh
bun run lint
bun run check
bun run test:unit -- --run
bun run build
bun run test:e2e
```

## Environment

Copy `.env.example` to `.env` if you need to override defaults.

Currently supported flags:

- `PUBLIC_ENABLE_COLLATION=true`

If unset, collation is enabled in dev and disabled in production/preview.

## Docker

The Dockerfiles expect the repository root as the build context because the app uses sibling workspace packages.

Example production build:

```sh
docker build -f app/Dockerfile.prod .
```

## Contributing

See `CONTRIBUTING.md` for development workflow and expectations.
