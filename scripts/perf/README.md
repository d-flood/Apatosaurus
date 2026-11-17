# Performance benchmarks

Drives the production build through import, project pages, Setup, Alignment, the editorial phases
and the editor with IGNTP Romans witnesses, logging worker requests over 200 ms. Run one benchmark
at a time on a quiet machine; parallel load skews timings badly.

```sh
cd app && pnpm run build && cd ../scripts/perf
./serve.sh 4480 node bench.mjs base100 100      # out/base100/results.json and a fresh profile
./serve.sh 4481 node bench.mjs after100 100
node compare.mjs out/base100/results.json out/after100/results.json
./serve.sh 4480 node rebuild.mjs out/base100/profile   # times an index rebuild after a schema bump
```

OPFS is per origin, so `rebuild.mjs` must use the port that created the profile. Copy the profile
first if you want to keep it.

## Results fields

- `results[].workerMs`: summed queue-exclusive DB worker time in the step, `reply − max(receipt, previous
  reply)`, valid because the worker runs queued requests one at a time. `ms` on each request still
  includes queue wait.
- `requests[]`: every worker request with its step (`phase`), `ms` and `exclusiveMs`. Methods in
  `unqueuedMethods` (`app/src/lib/db/api.ts`) bypass the queue, so their `exclusiveMs` is `null` and
  they are listed separately; their own `exclusive()` sections can inflate a queued request's time.
- `results[].writes` / `writeCount`: project-file writes per step by path, from patched
  `createSyncAccessHandle` and `createWritable` in workers and the page; SQLite index files are excluded.
- `storage.afterImport` / `storage.end`: OPFS bytes in total, in the SQLite index and in project files.

## What scholars feel

After the steps above, the run types in witness 2006, takes collation actions, opens a new tab and
moves the project into a fake Google Drive project location (`app/e2e/fake-google-sign-in.ts`,
loaded through `tsx`'s `tsImport`, so plain `node bench.mjs` still works).

- **Keystroke time** is Event Timing: the summed `processingEnd − processingStart` of every event a
  key dispatches (keydown, keypress, beforeinput, input, keyup), keys paced 100 ms apart so each has
  its own frame. It covers handlers, ProseMirror's DOM-change flush and Svelte effects, not
  rendering. Event Timing reports only events of 16 ms or more, so a key below that counts as 0.
- `typing[]`: `keyMs` for 20 keys at a line on the first, middle and last page of 2006, with p50 and
  p95. Each burst's autosave is the step `typing: autosave (<position>)`.
- `typePauseType[]`: three cycles of 20 keys and a 1.5 s pause at the middle page. `longestTaskMs`
  and `totalBlockingMs` come from Long Tasks (0 means no task reached 50 ms); `saveWorkerMs` is the
  exclusive time of the saves requested in the cycle; `saveToSavedMs` runs from the save request to
  "Unsaved local edits" disappearing, `null` when typing resumed before the save settled;
  `requestsAfterSave` lists the DB requests made until the next save or idle.
- Collation action steps (`readings: …`, `alignment: …`) add `settledFrameMs`: from the click or
  select change to two animation frames after the UI shows the change.
- `cold start: new tab → transcriptions` adds `init`, the DB worker's timed init steps, `quick_check`
  included, since a new tab verifies the index once per session.
- `sync: idle 60 s` adds `longestBackgroundSectionMs` and `totalBackgroundMs`;
  `sync: transcriptions page during sync` adds `waitBehindBackgroundMs`, the time its requests
  waited while a background section held the queue.
- `queue[]`: every DB queue section from the worker's `db-queue` User Timing measures, with
  `enqueuedAt`, `startedAt`, `endedAt` in epoch ms and `priority` (`user` or `background`). A queued
  request's label is its method; an unqueued method's `exclusive()` section is `<method>/section`.
  Results without `priority` count `/section` labels as background.
