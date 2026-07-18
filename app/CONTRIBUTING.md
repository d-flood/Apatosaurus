# Contributing to the Apatosaurus App

The storage model and its invariants are defined in
[`../.tracker/files-as-database/architecture.md`](../.tracker/files-as-database/architecture.md). Canonical
project files are the database; SQLite is a disposable index.

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

## Adding a Document Format Version

Canonical formats live in `src/lib/client/store/formats/` and are registered by
`src/lib/client/store/formats/index.ts`. Reads use the registry in
`src/lib/client/store/migrate-on-read.ts`: it verifies the old envelope hash, applies one pure upgrader per
version, validates the current payload and semantic integrity, then reseals the in-memory document at the
current version. Reading does not rewrite the file; a later save does.

To add version `N + 1` to an existing format:

1. In that format's module, increment its `*_CURRENT_VERSION`, add a pure `vN -> vN+1` upgrader, and append
   it to the exported upgrader array. Keep every earlier upgrader in order: array element `0` upgrades v1 to
   v2, element `1` upgrades v2 to v3, and so on. The registry requires exactly `currentVersion - 1`
   upgraders.
2. Update the current payload type, validator, and integrity validator in the same module. The upgrader must
   return a JSON object accepted by those current validators; it must not read or write storage.
3. Add checked-in old-input and expected-current-payload fixtures under
   `src/lib/client/store/formats/fixtures/`. Either check in a valid old sealed document or seal the old
   payload in the test before passing it to the registry. Its envelope `content_hash` must match the old
   payload.
4. Extend `src/lib/client/store/formats/formats.spec.ts` to read the old fixture through
   `readCanonicalDocument()`, assert `upgraded: true` and the original version, and compare its payload with
   the expected fixture. Keep current-version round-trip coverage in `FORMAT_FIXTURES` accurate.
5. Exercise the persisted upgrade path. Ticket 22's project-manifest example is
   `e2e/fixtures/upgrade-store/project.json` and the upgrade-fixture scenario in
   `e2e/files-as-database.spec.ts`. It seeds a valid old document and stale old index, starts the app, saves
   the document, exports it, and verifies the new schema version and old-index cleanup. Add or update
   equivalent project-folder fixture data when the new version affects that path.

Run the focused checks before the full quality gates:

```sh
bun run test:unit -- --run src/lib/client/store/formats/formats.spec.ts
bun run test:e2e -- -g "upgrade fixture"
```

Do not change `INDEX_SCHEMA_VERSION` for a document-format-only change. Document versions migrate on read;
`INDEX_SCHEMA_VERSION` changes only when the disposable SQLite schema changes.

## Adding a Storage Provider

Sync semantics are provider-independent and operate through `CloudStorageProvider` in
`src/lib/client/sync/providers/provider.ts`. To add a provider:

1. Implement every `CloudStorageProvider` operation in a new module under
   `src/lib/client/sync/providers/`, declare an ID and truthful `CloudProviderCapabilities`, and return
   stable metadata/revisions in the shapes defined by the interface.
2. Translate provider failures to `CloudProviderError` codes. In particular, preserve `conflict`,
   `not-found`, `permission-denied`, and `reauthorization-required` so sync can protect both copies and show
   reconnection state instead of silently stopping.
3. Add contract tests beside the provider covering recursive listing, create/download/update/delete,
   expected-revision conflicts, pagination if applicable, and authorization or permission loss. Use
   `mock-provider.ts` and `local-folder-provider.spec.ts` as examples.
4. Register construction in `src/lib/client/sync/provider-factory.ts`, including credential or handle
   loading. Do not add provider-specific branches to `sync-manager.ts`.
5. Extend the target connection and persistence UI for the provider. `SyncTargetRecord` and
   `createProviderForSyncTarget()` are currently local-folder-specific, so a non-folder production provider
   also needs an explicit provider ID plus provider-specific authorization references in the target model.
   Keep secrets out of canonical project files and the disposable SQLite index.
6. Run the provider tests, `src/lib/client/sync/sync-manager.spec.ts`, and the full quality gates.

Adding a provider must not change the file set, commit boundary, tombstone behavior, fingerprint comparison,
or conflict-copy semantics described in the architecture.
