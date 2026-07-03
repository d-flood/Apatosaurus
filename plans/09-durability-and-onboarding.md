# Phase 09: Durability and Onboarding

Status: Not Started
Depends on: Phases 06, 07, 08
Architecture reference: `architecture.md` sections 3 (decisions 5, 8), 9 (invariant 8)

## Goal

Close the remaining durability gaps and make the ownership model legible in the UI: storage persistence, project-first navigation, and recommended-setup onboarding (Chromium + installed PWA + sync folder).

## Scope

### Durability

1. Request `navigator.storage.persist()` at first meaningful write; re-check on startup. Surface the result: a persistent-storage status (granted / denied / unsupported) in settings and as a warning banner when data exists but persistence is not granted ("your browser may evict this data under storage pressure - install the app or export backups").
2. Storage estimate display (`navigator.storage.estimate()`): show usage in settings; warn as quota approaches.
3. PWA install prompt: a considered install nudge once a user has real data (installed PWAs get persistence and better permission retention on Chromium).
4. Backup-health panel: per project, show last committed, last synced (if folder connected), last exported; a project with commits but no sync target and no recent export shows an actionable "your data exists only in this browser" prompt. Replaces/absorbs `backup-health.ts`/`backup-status.ts` logic.

### Project-first UI

5. Navigation restructure: `/projects` is the hub. A project view exposes tabs or sections: Transcriptions, Collations, Settings (charter, collation settings, rules), Backup and Sync. Transcription and collation lists always render within their project context; the old top-level library framing goes away (route redirects preserved).
6. Entity headers (editor and collation workspace) show project name and commit state, making ownership and committed-vs-draft state visible at all times.
7. Lineage surfacing: a copied transcription shows "copied from <project> @ <short-hash>" with staleness indicator when the source has newer commits (data already present from Phase 4; this is display work).

### Onboarding

8. First-run and docs/about content: recommended setup is a Chromium-based browser, install the PWA, allow persistent storage, connect a sync folder (optionally inside a Dropbox/OneDrive/Drive-managed directory - the Obsidian/Zotero pattern). Firefox/Safari supported with zip export/import as the backup path.
9. Capability-aware messaging in one place (a `capabilities.ts` reporting `showDirectoryPicker`, OPFS, persistence, install state) consumed by all notices, replacing scattered feature checks.

## Non-Goals

- Visual redesign beyond information architecture; keep the existing component system (DaisyUI) and styling.
- Multi-user/permissions UI (`ProjectUserManagementStub` stays a stub or is removed).

## Design Notes

- The navigation change is the user-facing answer to "it isn't clear that transcriptions and collations belong to projects." Everything else in this plan makes it true; this phase makes it visible.
- Keep deep links working: `/transcription/[id]` and `/collation/[id]/[phase]` remain canonical editor routes; project views link into them.
- Persistence denial is common in non-installed Chromium and in Firefox private mode; the banner must be dismissible but recurrent on new data milestones, not nagging on every load.

## Checklist

- [ ] `storage.persist()` requested and status surfaced; warning banner conditions tested
- [ ] Storage estimate in settings
- [ ] Install nudge post-data-creation
- [ ] Backup-health panel with actionable states
- [ ] Project-first navigation with Transcriptions/Collations/Settings/Backup sections
- [ ] Entity headers show project + commit state
- [ ] Lineage/staleness display on copied transcriptions
- [ ] `capabilities.ts` consolidation; onboarding + about content updated
- [ ] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

A new user landing in the app is guided to the recommended setup; a user with unsynced, unexported data is clearly warned; no view exists in which a transcription or collation appears unowned.

## Verification

```bash
cd app
bun run check && bun run test:unit -- --run
```

Manual: walkthrough on Chromium (full path incl. install + folder), Firefox (persistence warning + export path), including first-run experience.

## Notes

| Date | Note |
| --- | --- |
