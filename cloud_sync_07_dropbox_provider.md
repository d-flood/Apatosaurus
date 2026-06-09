# Session 07: Dropbox Provider

## Goal

Implement `DropboxStorageProvider` against the Dropbox HTTP API using the provider interface from Session 06.

This is the first real cloud provider. Keep Dropbox-specific behavior inside the adapter except for typed capabilities and typed errors.

## Dependency

Complete [Session 06](cloud_sync_06_provider_auth_mock.md) first.

## Capabilities

Expected Dropbox capability values:

- `supportsFolderSharing: true`
- `supportsStableFileIds: false` if the adapter uses `path_lower` as the stable file handle for app-created files
- `supportsExpectedRevisionDelete: true` if delete calls are guarded by current metadata where available
- `requiresPathAddressing: true`
- `sharingMayBeAsync: true`

Adjust these if the implementation uses a stronger Dropbox file identifier in practice.

## OAuth PKCE

Dropbox authorization URL requirements:

```text
https://www.dropbox.com/oauth2/authorize?client_id=[CLIENT_ID]&response_type=code&code_challenge=[CHALLENGE]&code_challenge_method=S256&token_access_type=offline&state=[STATE]&redirect_uri=[REDIRECT_URI]
```

Token exchange:

```http
POST https://api.dropboxapi.com/oauth2/token
Content-Type: application/x-www-form-urlencoded

code=[AUTHORIZATION_CODE]&grant_type=authorization_code&client_id=[CLIENT_ID]&code_verifier=[CODE_VERIFIER]&redirect_uri=[REDIRECT_URI]
```

Use `token_access_type=offline` so Dropbox returns a refresh token.

## File and Folder Operations

Create folder:

```http
POST https://api.dropboxapi.com/2/files/create_folder_v2
Authorization: Bearer [ACCESS_TOKEN]

{ "path": "/Apatosaurus/Projects/[Project_ID]" }
```

List folder contents:

```http
POST https://api.dropboxapi.com/2/files/list_folder
Authorization: Bearer [ACCESS_TOKEN]

{ "path": "/Apatosaurus/Projects/[Project_ID]", "recursive": true }
```

Continue listing with `/2/files/list_folder/continue` whenever Dropbox returns `has_more`.

Download file:

```http
POST https://content.dropboxapi.com/2/files/download
Authorization: Bearer [ACCESS_TOKEN]
Dropbox-API-Arg: { "path": "/Apatosaurus/Projects/.../[File].json" }
```

Upload with expected revision:

```http
POST https://content.dropboxapi.com/2/files/upload
Authorization: Bearer [ACCESS_TOKEN]
Content-Type: application/octet-stream
Dropbox-API-Arg: {
  "path": "/Apatosaurus/Projects/.../[File].json",
  "mode": { ".tag": "update", "update": "[PARENT_REVISION]" },
  "autorename": false,
  "mute": false
}
```

Create new files with add semantics and `autorename: false` so name conflicts surface as conflicts instead of hidden renamed copies.

## Folder Sharing

Convert a project folder to a shared folder if needed:

```http
POST https://api.dropboxapi.com/2/sharing/share_folder

{ "path": "/Apatosaurus/Projects/[Project_ID]" }
```

Add collaborators:

```http
POST https://api.dropboxapi.com/2/sharing/add_folder_member

{
  "shared_folder_id": "[SHARED_FOLDER_ID]",
  "members": [
    {
      "member": { ".tag": "email", "email": "collaborator@example.com" },
      "access_level": { ".tag": "editor" }
    }
  ]
}
```

Dropbox sharing may be asynchronous. The provider should surface pending states cleanly rather than pretending sharing completed instantly.

## Error Mapping

Map Dropbox failures to typed provider errors:

- Expected revision mismatch or path conflict: `conflict`
- Auth expired, revoked, or invalid refresh token: `reauthorization-required`
- Insufficient scope or forbidden folder access: `permission-denied`
- Rate limit response: `rate-limited`
- Missing path/file: `not-found`
- Network or Dropbox service outage: `provider-unavailable`
- Anything else: `unknown` with diagnostic `providerDetails`

## Acceptance Criteria

- Dropbox auth URL and token exchange work with PKCE and no client secret.
- Access token refresh updates stored credentials, including rotated refresh tokens.
- Recursive listing handles cursors and pagination.
- File create/update/delete preserve project-relative paths and provider revisions.
- Expected-revision upload conflicts produce `CloudProviderError('conflict', ...)`.
- Dropbox errors do not leak raw provider response handling into sync-manager code.

## Verification

Run from `app/`:

```bash
bun run check
bun run test:unit -- --run
```

Use mocked fetch tests for most Dropbox adapter behavior. Real Dropbox smoke tests should be opt-in and skipped unless credentials are configured.
