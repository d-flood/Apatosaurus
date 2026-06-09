# Session 09: Google Drive Provider

## Goal

Add `GoogleDriveStorageProvider` after Dropbox and the core sync manager are stable.

This session validates that the provider abstraction is genuinely extensible without changing Apatosaurus' project file format or core sync state machine.

## Dependencies

- [Session 06](cloud_sync_06_provider_auth_mock.md)
- [Session 08](cloud_sync_08_sync_manager_polling_ui.md)

## Provider Model

Google Drive identifies folders and files by immutable ID strings. Keep those IDs in `cloud_file_id` and `cloud_folder_id`, while preserving Apatosaurus project-relative paths in `cloud_path` for deterministic sync logic and UX.

Expected capability differences from Dropbox:

- `supportsStableFileIds: true`
- `requiresPathAddressing: false`
- Folder sharing uses permissions rather than a Dropbox-style shared folder conversion.
- Conflict checks use ETags or generation preconditions.

## File Management

Folder creation:

```http
POST https://www.googleapis.com/drive/v3/files

{
  "name": "[Project_ID]",
  "mimeType": "application/vnd.google-apps.folder",
  "parents": ["[ParentFolder_ID]"]
}
```

File creation and updates target Drive upload endpoints. Store returned file IDs and ETags/generation values in sync metadata.

## Conflict Detection

Use `If-Match` or generation preconditions for updates.

```http
PUT https://www.googleapis.com/upload/drive/v3/files/[FILE_ID]?uploadType=media
If-Match: [LAST_SEEN_ETAG]
```

If the ETag no longer matches, Google Drive returns `412 Precondition Failed`. Map this to `CloudProviderError('conflict', ...)`.

## Collaboration

Google Drive folder collaboration uses the Permissions resource.

```http
POST https://www.googleapis.com/drive/v3/files/[FOLDER_ID]/permissions

{
  "role": "writer",
  "type": "user",
  "emailAddress": "collaborator@google.com"
}
```

Map Apatosaurus `viewer` and `editor` roles to Google Drive permission roles deliberately.

## Implementation Scope

- Implement Google OAuth PKCE using the Session 06 auth helpers.
- Implement folder create/share operations.
- Implement file create/update/delete/download/list operations using Drive IDs.
- Preserve project-relative paths in metadata even though Drive operations use IDs.
- Map Drive errors into typed provider errors.
- Reuse all sync manager tests through provider contract tests where possible.

## Acceptance Criteria

- Existing sync manager code works with Google Drive without file format changes.
- Drive file IDs and ETags/generations are persisted in `cloud_sync_metadata`.
- Update conflicts map to typed `conflict` errors.
- Folder permissions implement Apatosaurus share roles safely.
- Dropbox-specific assumptions do not leak into shared sync-manager code.

## Verification

Run from `app/`:

```bash
bun run check
bun run test:unit -- --run
```

Use mocked fetch tests for provider behavior. Real Google Drive smoke tests should be opt-in and skipped unless credentials are configured.
