# Session 02: Project Transcription Snapshots

## Goal

Refactor project transcription behavior so every project links to a project-owned transcription snapshot instead of a mutable global transcription row.

This keeps shared project folders self-contained and prevents Project A from exposing or modifying Project B or a user's private global transcription library.

## Dependency

Complete [Session 01](cloud_sync_01_initial_schema.md) first.

## Core Model

Transcriptions have two distinct identities:

- Project snapshot identity: the concrete `transcriptions` row used by the project and edited inside the project.
- Canonical/provenance identity: optional metadata describing the global transcription, source project, or source revision used to create the snapshot.

The canonical identity is useful for later comparison/update workflows. It is not a live sync link.

## Implementation Scope

- Update project add/link flows so adding a transcription to a project clones it into a new `transcriptions` row with `scope_type = 'project_snapshot'`.
- Set the cloned row's `project_id`, `origin_type`, `origin_project_id`, `origin_transcription_id`, `origin_revision_id`, and `origin_content_hash`.
- Insert a `project_transcriptions` row whose `id` is the stable project transcription file identity.
- Copy associated IIIF manifest sources, page canvas links, and canvas annotations needed by the snapshot.
- Update project editing/query code to load through `project_transcriptions` and then the snapshot transcription row.
- Update global library queries to exclude project snapshots.
- Ensure edits in one project do not update a canonical transcription or another project's snapshot.

## Copy-On-Link Rules

1. A canonical/global transcription can exist in the user's local library and optionally in a future private cloud folder.
2. Adding a transcription to a project creates a project-owned snapshot row.
3. The project folder will later sync that snapshot as `transcriptions/[ProjectTranscription_ID].json`.
4. Edits made inside Project A update only Project A's snapshot.
5. Moving changes between a project snapshot and a canonical/global transcription is always an explicit user action.

## Explicit Future Actions

These actions can be UI stubs or follow-up issues if they are not needed to complete the current refactor:

- Add to Project: copy a canonical/global transcription or another project snapshot into a project.
- Update Project Snapshot: compare a project snapshot with a newer canonical/global version and apply the update as a new project commit.
- Publish to Canonical: promote a project snapshot back to the user's canonical/global transcription.
- Compare Snapshots: compare two project snapshots that share provenance and let the user reconcile manually.

## Data Validation

- A project snapshot should not claim to still be the canonical current revision after local edits.
- When copying a canonical transcription or project snapshot into a project, record the source revision and source content hash if available.
- If the source has no committed revision yet, use empty source revision/hash fields and treat the new project snapshot as uncommitted.

## Acceptance Criteria

- Adding a transcription to a project creates a distinct project snapshot row.
- Editing a project transcription updates only the project snapshot row.
- The global library does not show project snapshot rows.
- The project can still list and open its transcriptions through `project_transcriptions`.
- Provenance fields are populated consistently when source revision metadata exists.

## Verification

Run from `app/`:

```bash
bun run check
bun run test:unit -- --run
```

Add or update unit tests around project transcription creation, project listing, and global library filtering.
