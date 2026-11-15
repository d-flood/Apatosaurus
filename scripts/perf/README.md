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
