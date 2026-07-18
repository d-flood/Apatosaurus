# Apatosaurus App

SvelteKit application for manuscript transcription, IIIF-assisted annotation, and collation workflows.

## Status

This app is active work in progress. The codebase is intended to be readable and contributor-friendly even where product surfaces are incomplete.

Current workspace constraint:

- the app currently lives inside this monorepo and depends on sibling packages under `../triiiceratops`, `../collatex`, and `../packages/tei-transcription`

## Persistence Architecture

The accepted architecture is
[`../.tracker/files-as-database/architecture.md`](../.tracker/files-as-database/architecture.md). Canonical
project data lives as versioned, hash-validated files in OPFS. SQLite contains only rebuildable listings,
indexes, and projections; deleting it must not lose user data.

For an index schema change:

1. Edit `src/lib/client/db/migrations/0001_initial.sql`, which defines the current greenfield index schema.
2. Increment `INDEX_SCHEMA_VERSION` in `src/lib/client/db/schema-version.generated.ts` so the app opens a new
   versioned index and rebuilds it from project files. Do not write a runtime SQL migration or delete the
   current database in application code.
3. Run `bun run db:generate` and commit the updated `src/lib/client/db/types.generated.ts`.
4. Run `bun run db:check`, `bun run check`, and the index-rebuild tests before the full test suite.

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

## Docker

The Dockerfiles expect the repository root as the build context because the app uses sibling workspace packages.

Example production build:

```sh
docker build -f app/Dockerfile.prod .
```

## Contributing

See `CONTRIBUTING.md` for development workflow, document-format versioning, and storage-provider extension
points.
