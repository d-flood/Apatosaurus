# Subplan 7: Local Filesystem Provider

## Selection Rationale

This subplan should follow cloud backup and restore because the local filesystem provider should not create a parallel export/import model. It should be another implementation of the same provider abstraction, using the same project folder layout, backup panel, browser, and restore flow.

The app already has a separate transcription-only external folder sync using the File System Access API. That is useful prior art for permissions and handle persistence, but it should not become the final project backup model.

## Goal

Treat a user-selected local folder as another backup provider using the same project-contained file layout and UI as Dropbox, Google Drive, and mock cloud providers.

After this subplan, users should be able to:

- Choose `Local folder` as a backup target provider.
- Select a local directory through the File System Access API.
- Back up project folders into that directory using the same `Apatosaurus/Projects/{projectId}` layout.
- Browse projects in that directory through the cloud project browser from Subplan 6.
- Restore projects from that directory.
- Poll the local folder project's `project.json` manifest and prompt before pulling updates, using the same flow as cloud providers.
- Continue using OAuth providers on browsers/devices that do not support local directory access.

## Non-Goals

- Do not create a second project file format.
- Do not reuse the transcription-only external sync file layout as project backup output.
- Do not require local folder support on unsupported browsers or mobile environments.
- Do not block OAuth providers while adding local folder support.
- Do not use local folder backup as proof of safe removal until Subplan 8 health checks are implemented.

## Current Grounding

### Existing Provider Interface

`app/src/lib/client/sync/providers/provider.ts` defines `CloudStorageProvider` with:

- OAuth-style auth methods: `getAuthUrl`, `exchangeCode`, `refreshCredentials`.
- Folder operations: `createFolder`, `shareFolder`.
- File operations: `listFiles`, `downloadFile`, `createFile`, `updateFile`, `deleteFile`.

This interface currently assumes every provider is OAuth-like. A local folder provider does not need OAuth and cannot implement meaningful token exchange.

### Existing Providers

Current provider implementations include:

- `DropboxStorageProvider`
- `GoogleDriveStorageProvider`
- `MockCloudStorageProvider`

Provider capability fields already express some behavior differences:

- `supportsFolderSharing`
- `supportsStableFileIds`
- `supportsExpectedRevisionDelete`
- `requiresPathAddressing`
- `sharingMayBeAsync`

Additional capability fields may be needed for non-OAuth providers and local directory support.

### Existing File System Access Prior Art

`app/src/lib/client/transcription/external-sync-service.ts` already demonstrates:

- Feature detection for `window.showDirectoryPicker`.
- Requesting read/write permission on `FileSystemDirectoryHandle`.
- Persisting a structured-clone directory handle in IndexedDB.
- Restoring the handle and checking permission on startup.
- Storing handle state separately from SQLite metadata.

This prior art should be reused conceptually, not as the final project backup format.

## Product Semantics

### Local Folder Provider

A local folder provider is a provider connection whose storage root is a user-selected directory.

Rules:

- It uses the same `CloudStorageProvider` file operations as remote providers.
- It writes JSON project files using the same layout.
- It stores durable provider metadata in SQLite `cloud_connections`.
- It stores the non-serializable `FileSystemDirectoryHandle` in IndexedDB keyed by connection ID.
- It must handle permission revocation gracefully.

### Connection

For a local folder provider, connection means:

- User selected a directory.
- App has or can request read/write permission.
- SQLite has a `cloud_connections` record.
- IndexedDB has a matching directory handle for that connection ID.

It does not mean OAuth credentials exist.

### Revision Identity

Local filesystems do not provide stable cloud revisions like Dropbox/Drive.

The provider should synthesize file revisions deterministically enough for conflict detection:

- Use file metadata such as `lastModified` and size if available.
- Or compute a content hash on read/write.
- Prefer content-hash-based revision strings for JSON files because they align with sync safety.

## Provider Interface Refactor

### Problem

`CloudStorageProvider` currently requires OAuth methods:

- `getAuthUrl`
- `exchangeCode`
- `refreshCredentials`

A filesystem provider cannot implement these meaningfully.

### Recommended Change

Split provider concepts:

```ts
export interface CloudStorageProvider {
	id: string;
	name: string;
	capabilities: CloudProviderCapabilities;
	createFolder(folderName: string, parentFolderId?: string): Promise<string>;
	shareFolder(folderId: string, inviteeEmail: string, role: 'viewer' | 'editor'): Promise<void>;
	listFiles(folderId: string, options?: { recursive?: boolean; cursor?: string }): Promise<CloudListResult>;
	downloadFile(fileId: string): Promise<string>;
	createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult>;
	updateFile(fileId: string, content: string, expectedRevision: string): Promise<CloudWriteResult>;
	deleteFile(fileId: string, expectedRevision?: string): Promise<void>;
}

export interface OAuthCloudStorageProvider extends CloudStorageProvider {
	getAuthUrl(state: string, codeChallenge: string): string;
	exchangeCode(code: string, codeVerifier: string): Promise<CloudCredentials>;
	refreshCredentials(refreshToken: string): Promise<CloudCredentials>;
}
```

Alternative:

- Keep methods optional on `CloudStorageProvider`.

Recommendation:

- Use a separate OAuth interface for type safety.
- Update Dropbox, Google Drive, and mock auth tests accordingly.
- Local folder provider implements only `CloudStorageProvider`.

### Capability Additions

Add fields if useful:

```ts
export interface CloudProviderCapabilities {
	supportsFolderSharing: boolean;
	supportsStableFileIds: boolean;
	supportsExpectedRevisionDelete: boolean;
	requiresPathAddressing: boolean;
	sharingMayBeAsync: boolean;
	requiresOAuth: boolean;
	requiresUserGestureForConnection: boolean;
	supportsDirectoryHandlePersistence: boolean;
}
```

## Local Folder Provider Design

### File Identity

Use a provider-specific file ID format.

Recommended:

- Folder ID: normalized relative folder path from selected root.
- File ID: normalized relative file path from selected root.

Examples:

- root folder ID: `.`
- project folder ID: `Apatosaurus/Projects/project-1`
- project manifest file ID: `Apatosaurus/Projects/project-1/project.json`

Reasoning:

- File System Access handles are not serializable through SQLite.
- Relative paths are stable and human-readable.
- Provider can resolve handles from root directory on demand.

### Revision Strategy

Recommended revision string:

- `sha256:{contentHash}` for files after download/write.

For listing metadata:

- If computing hashes for every file during recursive list is too expensive, use `mtime-size:{lastModified}:{size}` for list results and compute hash on download.
- For conflict-sensitive writes, read current file content and compute hash before update.

Preferred first implementation:

- Compute content hash for JSON files when listing recursively in project backup/browser paths.

Reasoning:

- Project backups are small enough for correctness-first implementation.
- Content hash makes expected revision checks meaningful.

### Directory Operations

Implement provider methods:

- `createFolder(folderName, parentFolderId)` creates or returns folder under parent.
- `listFiles(folderId, { recursive })` walks directory handles.
- `downloadFile(fileId)` reads text from file handle.
- `createFile(folderId, path, content)` creates file and intermediate folders.
- `updateFile(fileId, content, expectedRevision)` verifies current revision then writes.
- `deleteFile(fileId, expectedRevision?)` verifies current revision if supplied then removes file.
- `shareFolder` throws `permission-denied` or no-ops with clear unsupported message.

Provider errors should use existing `CloudProviderError` codes:

- `permission-denied` for revoked permission.
- `not-found` for missing path.
- `conflict` for expected revision mismatch.
- `provider-unavailable` for unsupported browser/handle issues.

## Handle Persistence

### IndexedDB Store

Create a provider handle store similar to external sync but keyed by cloud connection ID.

Suggested constants:

- DB name: `apatosaurus-provider-handles`
- Store: `directory-handles`
- Key: `connectionId`

Stored value:

- `FileSystemDirectoryHandle`

SQLite stores:

- provider ID: `local-folder`
- account label: selected directory name or path label

Credentials field:

- Use an inert credential shape only if schema requires `access_token`.
- Example `accessToken = 'local-folder'`.
- Prefer future schema refactor if connection credentials become provider-specific.

### Permission Flow

Connection flow:

1. Feature-detect `showDirectoryPicker`.
2. User clicks `Connect local folder`.
3. App calls `showDirectoryPicker({ mode: 'readwrite' })`.
4. App requests read/write permission.
5. App creates/upserts `cloud_connections` row.
6. App stores handle in IndexedDB keyed by connection ID.
7. App creates or selects project backup folder through provider operations.

Startup flow:

1. Load local folder connections from SQLite.
2. Load matching handles from IndexedDB.
3. Query permission without prompting.
4. If permission is granted, provider is usable.
5. If permission is prompt/denied, mark connection `permission required` and require user action.

## UI Plan

### Provider Picker

Update provider connection UI to include:

- Dropbox

- Google Drive if already exposed or planned

- Local folder

For `Local folder`:

- Show only if supported.
- If unsupported, show disabled option with `Local folder backup is not supported in this browser.`
- If permission revoked, show `Reconnect folder`.

Current `CloudConnectButton.svelte` is Dropbox-specific. It should be replaced or wrapped by a provider picker component.

Potential components:

- `ProviderConnectButton.svelte`
- `ProviderConnectionMenu.svelte`
- `LocalFolderConnectButton.svelte`

### Projects Page Backup Panel

Subplan 5's backup panel should work unchanged once the local folder provider is connected.

The panel should show provider label:

- `Local folder: {directoryName}`

### Cloud Project Browser

Subplan 6's browser should list project folders from the selected local folder provider.

This is a key acceptance criterion: local folder backup and restore must use the same browser/import path.

Manifest polling should also work through the local folder provider. The provider reads `project.json`, compares manifest heads to local committed heads, and prompts the user before applying remote folder changes.

## Relationship to External Folder Sync

Existing transcription external sync writes transcription JSON/TEI mirrors. It is not project backup.

This subplan should:

- Reuse permission and IndexedDB handle persistence ideas.
- Avoid reusing its output paths as backup paths.
- Avoid calling `externalSyncService` from project backup code.
- Consider later deprecating or repositioning transcription external sync as an export/mirror feature.

## Testing Plan

### Unit Tests

Browser File System Access API is hard to test directly, so create provider tests with fake directory handles.

Target files:

- New `local-folder-provider.spec.ts`
- Provider factory tests
- Project backup/restore tests using local folder provider fake

Cases:

- Creates nested folders.
- Writes, reads, updates, and deletes JSON files.
- Lists files recursively with expected paths.
- Detects expected revision conflict.
- Throws permission errors when handle access fails.
- Works with `backupProject` from Subplan 5.
- Works with cloud project browser/import from Subplan 6.
- Works with manifest polling and user-confirmed pull from Subplan 6.

### Manual Tests

Manual flow:

1. Use a desktop Chromium-based browser.
2. Connect `Local folder`.
3. Back up a committed project.
4. Inspect the selected directory and confirm `Apatosaurus/Projects/{projectId}` layout.
5. Reset local database.
6. Reconnect the same folder.
7. Browse and restore the project.
8. Modify the folder's manifest through a second local database or test fixture and confirm UI prompts before pulling updates.
9. Revoke permission or move folder and confirm UI asks to reconnect.

## Verification Commands

Run from `app/`:

```sh
bun run check
bun run db:check
bun run test:unit -- --run src/lib/client/sync/providers/local-folder-provider.spec.ts
bun run test:unit -- --run src/lib/client/sync/sync-manager.spec.ts
```

Run Svelte validation/autofixer for edited `.svelte` and `.svelte.ts` files.

## Acceptance Criteria

- Provider abstraction supports non-OAuth providers cleanly.
- Local folder provider can be connected through supported browsers.
- Directory handle is persisted in IndexedDB keyed by connection ID.
- SQLite connection metadata records local folder provider connections.
- Project backup writes the same cloud layout into the local folder.
- Project browser/restore reads from the local folder provider.
- Manifest polling and opt-in pull work against local folder provider.
- Unsupported browsers degrade gracefully.
- Permission revocation is handled clearly.
- Existing Dropbox/Google/mock provider tests continue to pass.

## Risks and Mitigations

### Risk: File System Access API Is Not Universal

Mitigation:

- Feature-detect support.
- Keep OAuth providers available.
- Show local folder as unavailable where unsupported.

### Risk: Handles Cannot Be Stored in SQLite

Mitigation:

- Store handles in IndexedDB.
- Store only metadata in SQLite.
- Key handle store by connection ID.

### Risk: Revision Semantics Differ From Cloud Providers

Mitigation:

- Use content-hash-based revisions for JSON files.
- Verify expected revision before updates/deletes.

### Risk: Users Choose a Folder With Existing Unrelated Files

Mitigation:

- Write under `Apatosaurus/Projects` by default.
- Browser should only treat folders with valid `project.json` as projects.

## Open Questions

- Should local folder provider support sharing operations as a clear unsupported error or omit sharing UI entirely?
- Should the selected directory itself be the provider root, or should the app always create an `Apatosaurus` subfolder under it?
- Should content hashes be computed during all listings or only when downloading project files?

## Recommended First Implementation Slice

1. Split OAuth provider interface from storage provider interface.
2. Implement local folder provider with fake-handle tests.
3. Add local folder connection metadata plus IndexedDB handle store.
4. Add provider picker UI option.
5. Verify project backup and project browser flows work with local folder provider.
