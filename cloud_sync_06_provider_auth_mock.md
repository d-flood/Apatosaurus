# Session 06: Provider Interface, Auth, and Mock Provider

## Goal

Create the provider abstraction, browser-safe OAuth PKCE flow foundation, local credential storage model, and mock provider used by sync tests.

This session should not require Dropbox API credentials.

## Dependencies

- [Session 01](cloud_sync_01_initial_schema.md)
- [Session 04](cloud_sync_04_serialization_formats.md)

## Provider Interface

Create a provider-neutral interface around core file and folder operations, typed capabilities, and typed errors. Suggested location: `app/src/lib/client/sync/providers/provider.ts`.

```ts
export interface CloudFileMetadata {
  id: string;
  path: string;
  name: string;
  revision: string;
  modifiedAt: string;
  size: number;
  isFolder: boolean;
  isDeleted?: boolean;
}

export interface CloudListResult {
  entries: CloudFileMetadata[];
  cursor?: string;
  hasMore: boolean;
}

export interface CloudWriteResult {
  id: string;
  path: string;
  revision: string;
  modifiedAt: string;
  size: number;
}

export interface CloudCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface CloudProviderCapabilities {
  supportsFolderSharing: boolean;
  supportsStableFileIds: boolean;
  supportsExpectedRevisionDelete: boolean;
  requiresPathAddressing: boolean;
  sharingMayBeAsync: boolean;
}

export type CloudProviderErrorCode =
  | 'conflict'
  | 'permission-denied'
  | 'rate-limited'
  | 'not-found'
  | 'reauthorization-required'
  | 'provider-unavailable'
  | 'unknown';

export class CloudProviderError extends Error {
  constructor(
    readonly code: CloudProviderErrorCode,
    message: string,
    readonly providerDetails?: unknown,
  ) {
    super(message);
  }
}

export interface CloudStorageProvider {
  id: string;
  name: string;
  capabilities: CloudProviderCapabilities;

  getAuthUrl(state: string, codeChallenge: string): string;
  exchangeCode(code: string, codeVerifier: string): Promise<CloudCredentials>;
  refreshCredentials(refreshToken: string): Promise<CloudCredentials>;

  createFolder(folderName: string, parentFolderId?: string): Promise<string>;
  shareFolder(folderId: string, inviteeEmail: string, role: 'viewer' | 'editor'): Promise<void>;

  listFiles(folderId: string, options?: { recursive?: boolean; cursor?: string }): Promise<CloudListResult>;
  downloadFile(fileId: string): Promise<string>;
  createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult>;
  updateFile(fileId: string, content: string, expectedRevision: string): Promise<CloudWriteResult>;
  deleteFile(fileId: string, expectedRevision?: string): Promise<void>;
}
```

## Abstraction Boundary

- Provider implementations translate provider-specific API failures into `CloudProviderError` codes.
- Sync code branches on typed errors, not Dropbox or Google Drive response shapes.
- Provider-specific payloads can be attached as `providerDetails` for diagnostics.
- Capabilities must expose correctness-affecting differences such as path addressing, stable file IDs, expected-revision deletes, and async sharing.

## Static PKCE Auth Foundation

Apatosaurus uses a static browser-first architecture, so do not store a client secret in browser code.

PKCE flow requirements:

1. Generate a cryptographically secure `code_verifier`.
2. Compute a SHA-256 `code_challenge` using S256.
3. Store the `code_verifier` and `state` temporarily for callback validation.
4. Redirect to the provider authorization URL.
5. Handle the callback in a client route/page, not a SvelteKit `+server` endpoint while static deployment is retained.
6. Exchange `code` plus `code_verifier` for access and refresh tokens.
7. Remove token-bearing query params from the browser URL after callback handling.

## Token Storage Risk

Without a backend token broker, OAuth tokens are accessible to JavaScript running on the Apatosaurus origin. This is an accepted tradeoff for the static app architecture.

Mitigations for this session:

- Request narrow provider scopes.
- Store tokens in IndexedDB-backed SQLite, not `localStorage`.
- Never log tokens or full token responses.
- Use short-lived access tokens and refresh only when needed.
- Replace stored refresh tokens when the provider rotates them.
- Provide local disconnect/wipe primitives even if full UI arrives later.
- Treat XSS prevention and Content Security Policy as part of the sync threat model.

## Mock Provider

Build an in-memory or test-persistent `CloudStorageProvider` implementation for deterministic tests.

Mock behavior should support:

- Folder creation.
- Recursive and paginated listing.
- File create/update/delete.
- Revision increments on writes.
- Expected-revision conflicts.
- Missing files.
- Rate limit and provider unavailable error injection.
- Permission and reauthorization error injection.

## Acceptance Criteria

- Provider interface compiles and is provider-neutral.
- PKCE helper functions can generate verifier/challenge/state values and validate callback state.
- Cloud credentials can be stored, updated, refreshed, and wiped locally without logging token values.
- Mock provider can simulate normal writes, paginated lists, conflicts, deletes, and provider errors.

## Verification

Run from `app/`:

```bash
bun run check
bun run test:unit -- --run
```

Add unit tests for PKCE helpers, credential persistence, and mock provider conflict behavior.
