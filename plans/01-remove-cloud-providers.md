# Phase 01: Remove Direct Cloud Providers

Status: Not Started
Depends on: None
Architecture reference: `architecture.md` sections 3 (decision 5-6), 8

## Goal

Shrink the sync surface before the storage inversion. Delete the Dropbox and Google Drive OAuth integrations and all token/auth plumbing while keeping the provider seam (`StorageProvider` interface, local-folder provider, mock provider) fully intact.

## Scope

1. Delete provider implementations:
   - `app/src/lib/client/sync/providers/dropbox-provider.ts`
   - `app/src/lib/client/sync/providers/google-drive-provider.ts`
2. Delete OAuth/auth plumbing:
   - `app/src/lib/client/sync/cloud-auth.ts` (retain any directory-picker helpers by moving them next to `local-folder-handles.ts`)
   - `app/src/lib/client/sync/auth/pkce.ts`
   - `app/src/routes/accounts/login/+page.svelte`, `app/src/routes/accounts/register/+page.svelte` if they exist only for provider auth
3. Simplify `provider-factory.ts` to local-folder and mock only.
4. Remove OAuth-token persistence:
   - Drop `cloud_connections` usage for tokens. If Phase 4 has not landed yet, leave the table in the schema but remove all reads/writes of token fields; the table is removed for good in Phase 4.
5. Update UI:
   - `CloudConnectButton.svelte`, `ProjectBackupPanel.svelte`, `CloudProjectBrowser.svelte`, sync status components: remove provider-selection and OAuth states; the only connect action is "Choose sync folder".
   - Where a non-Chromium browser lacks `showDirectoryPicker`, show a capability notice pointing at zip export (Phase 8) rather than a broken button.
6. Remove provider-specific tests and env config (Dropbox/Drive client IDs in `.env`, docs).
7. Consult `current-state.md` section 7 for the OAuth-era cleanup inventory (`/accounts/*` routes and related dead code). Do not touch the legacy external transcription folder sync in this phase; it is retired in Phase 7.

## Non-Goals

- Do not redesign the sync manager (Phase 7).
- Do not remove `mock-provider.ts` or any provider-neutral types in `providers/provider.ts`.
- Do not touch cloud file formats (`cloud-files.ts`); Phase 3 promotes them.

## Design Notes

- The `StorageProvider` interface and typed provider errors stay exactly as they are; the deleted providers must be removable without changing the interface. If they are not, fix the interface leak first and note it here.
- Grep for `dropbox`, `googleDrive`, `google_drive`, `oauth`, `pkce`, `access_token`, `refresh_token` across `app/src` to find stragglers.
- Keep `sync_tombstones`, `cloud_sync_metadata`, `cloud_project_folders` untouched for now; Phases 4 and 7 rework them.

## Checklist

- [ ] Dropbox provider, Drive provider, OAuth, PKCE code deleted
- [ ] Provider factory offers local-folder and mock only
- [ ] No reads/writes of OAuth token fields remain
- [ ] UI shows folder-based connect only, with capability notice on unsupported browsers
- [ ] Env/docs cleaned of provider app registration references
- [ ] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

The app builds and all tests pass with no reference to Dropbox/Google Drive APIs anywhere in `app/src`. Local-folder backup still works end-to-end in a Chromium browser (manual smoke test: connect folder, back up project, import project).

## Verification

```bash
cd app
grep -ri "dropbox\|google.drive\|pkce" src && echo "FAIL: stragglers" || echo "clean"
bun run check
bun run test:unit -- --run
```

## Notes

| Date | Note |
| --- | --- |
