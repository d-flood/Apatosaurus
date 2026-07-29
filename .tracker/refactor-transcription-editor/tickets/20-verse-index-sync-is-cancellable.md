# Ticket 20: Verse-index sync is cancellable

## Parent

`../INVENTORY.md` F39.

## What to build

Every mount schedules a verse-index sync. The debounce exposes no cancel and no flush, and neither teardown branch clears its timeout. A mounted editor that is immediately unmounted still runs the sync about 1.2 seconds later.

That function is not index-only: it calls `updateTranscriptionContent` with the captured whole document. So a component that no longer exists performs a full document write and cache invalidation — and if anything else wrote to that transcription between navigation and the timer firing, this silently reverts it.

## Where to start

`app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte:651` (the scheduling), `:679` (teardown), `:987` `createDebouncedVerseIndexSync`; and `app/src/lib/client/transcription/verse-index.ts:107` `syncVerseIndexFromDocument`.

Both teardown branches need to clear it — check each, they are not symmetrical.

Ticket 04 moves `coerceEditorJsonToDocument` **inside** these timers (F24), which is why this ticket is blocked by it: once the conversion is inside the callback, the callback is the only thing holding the document, and cancelling it is both necessary and sufficient. Doing this first would mean writing the cancel twice.

## Contract

- The debounce exposes `cancel()` and `flush()`.
- Component teardown cancels any pending verse-index sync, on **every** teardown path.
- The same treatment is applied to `createDebouncedAutosave` if it has the same gap — check it; do not assume either way.
- **Decide and record whether unmount should flush or drop a pending sync.** Dropping is probably right, since the next mount re-derives the index, and flushing re-introduces the stale-write window this ticket exists to close. Write the reasoning in `TRACKER.md`.
- No write to `updateTranscriptionContent` originates from an unmounted component.
- Verse-index sync still happens on its existing interval during normal editing.

## Out of scope

- The cost of the conversion itself (F24) — ticket 04.
- Making `syncVerseIndexFromDocument` index-only rather than a full document write. It is worth questioning why an index sync writes the document at all, but that is a larger change; record it as a finding in `../INVENTORY.md` if you scope it.
- The autosave interval or its semantics.

## Acceptance criteria

- [ ] Mounting and immediately unmounting a real editor produces no call to `syncVerseIndexFromDocument`, asserted by a spy after waiting past the debounce interval.
- [ ] The same for autosave, if it shares the gap.
- [ ] Normal editing still syncs the verse index on the existing interval.
- [ ] Both teardown paths are covered by a test.
- [ ] `TRACKER.md` records the flush-or-drop decision.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm run check
pnpm run test:unit -- --run
```

Success: the mount/unmount spec waits out the debounce and sees no write; editing still syncs.

## Blocked by

- Ticket 04 (`04-structure-repair-leaves-the-keystroke-path.md`) — it moves the document conversion inside these timers, which changes what cancelling has to clean up.
