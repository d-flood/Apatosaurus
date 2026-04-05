# Resilient Automatic Sync Model for Djazzkit

  ## Summary

  Refactor djazzkit’s sync/reactivity model so it remains automatic for users but no longer ties write throughput, query subscriptions, and worker/runtime liveness together so
  tightly that one slow path can poison the whole system.

  The target behavior is:

  - local writes still update the UI automatically
  - remote sync still happens automatically when available
  - cross-tab updates still appear automatically
  - bulk/background workloads can run for hours without requiring restarts
  - runtime/storage failures fail fast and visibly instead of degrading into hanging requests
  - query subscriptions remain reactive, but refresh cost is bounded and coalesced

  This is a djazzkit architectural change, not an app-only patch.

  ## Key Changes

  ### 1. Separate write acknowledgment from reactive refresh work

  Today Manager.create/update/delete() awaits notifyTableChanged(), and notifyTableChanged() immediately re-runs every subscribed query on affected tables.

  Change the contract:

  - local writes should complete once the DB mutation and required sync metadata writes are durably recorded
  - reactive updates should be scheduled asynchronously after the write, not awaited inline
  - write latency must not scale with the number or size of active subscriptions

  Implementation shape:

  - notifyTableChanged() becomes an invalidation scheduler, not a synchronous refresh barrier
  - maintain a dirty-table set and one scheduled flush per event loop tick
  - if multiple writes affect the same table during a burst, coalesce them into one refresh cycle
  - keep automatic UI updates, but make them eventual-within-a-tick rather than part of the write critical path

  ### 2. Introduce a batched mutation / deferred invalidation API

  djazzkit needs a first-class bulk-write path.

  Add a mutation batching API in core, for example:

  - runWriteBatch(async () => { ... })
  - or beginMutationBatch()/endMutationBatch()

  Batch semantics:

  - local DB writes execute normally
  - affected tables are recorded
  - reactive invalidation is deferred until batch end
  - one refresh flush happens once per batch, or once per configured chunk
  - nested batches coalesce naturally
  - cross-tab invalidation is also coalesced per table per batch

  Use this for:

  - bulk imports
  - sync apply phases
  - reconciliation/reset flows
  - any future codegen/migration or large local mutation workload

  ### 3. Replace full-result JSON snapshot dedupe with bounded-cost subscription invalidation

  Current QueryStore.refresh() re-runs the query and JSON.stringifys the entire result set for dedupe. That does not scale.

  Replace with one of these bounded-cost strategies:

  - row signature dedupe: build a stable signature from _djazzkit_id, _djazzkit_rev, _djazzkit_deleted, and row count
  - or versioned table invalidation: if a table version changed, notify subscribers without full deep snapshot comparison
  - or batched-store mode: when refresh comes from a write batch, skip deep dedupe and notify once

  Recommended default:

  - local-mode QueryStore tracks a lightweight result signature, not full JSON
  - for large result sets, avoid reserializing entire payloads
  - keep deep dedupe only as an optional fallback/debug mode, not the mainline path

  This preserves automatic UI updates while removing a likely O(n)-per-write tax.

  ### 4. Add fast-path local create/update APIs for high-volume workloads

  Manager.create() currently:

  - inserts the row
  - re-queries the inserted row
  - notifies subscribers
  - enqueues sync metadata

  For local bulk workloads, add a fast path:

  - optional createLocalFast() / createManyLocal() API
  - skip immediate reread when caller already supplies authoritative row data
  - allow chunked bulk insert in a single transaction
  - emit one batched invalidation at the end
  - enqueue sync metadata in bulk rather than per-row round-trips where possible

  This does not replace the ergonomic default Manager.create(), but provides a scalable path for importers and background jobs.

  ### 5. Make sync bookkeeping automatic but cheaper

  Preserve automatic sync behavior, but decouple it from subscription pressure.

  Changes:

  - keep _djazzkit_upload_queue as the durable sync source of truth
  - enqueue upload metadata durably during writes as today
  - request upload drain asynchronously, never in the write critical path
  - coalesce repeated drain requests
  - optionally support bulk queue enqueue for batched mutations
  - ensure upload drain and reactive refresh do not compete in a way that blocks local writes

  For sync apply:

  - keep remote changes automatically reflected locally
  - apply remote ops in DB transactions
  - defer/coalesce reactive invalidation until transaction completion
  - avoid one notifyTableChanged() barrier per small sync chunk if more chunks are immediately following

  ### 6. Make runtime/storage failure handling explicit and fatal-state based

  A resilient sync model needs a resilient runtime contract.

  Required changes:

  - OPFS-only local SQLite runtime
  - no fallback to IDB for important local-first data
  - normalize runtime/storage failures into structured fatal errors
  - store fatal worker state once runtime becomes unusable
  - reject all later requests immediately with the same fatal error
  - preserve local data; never auto-reset in core

  This ensures sync, reactivity, and subscriptions all fail deterministically instead of creating request pileups and 30s timeouts.

  ### 7. Add backpressure-aware scheduling between writes, refreshes, and sync

  The shared runtime currently serializes all worker requests. Keep single-flight SQLite access, but make scheduling less fragile.

  Add internal priority rules:

  - runtime/storage init and explicit DB writes have highest priority
  - invalidation-triggered subscription refreshes are lower priority and coalesced
  - sync upload drain is opportunistic and resumable
  - repeated table refresh requests while a refresh is already queued/in-flight should collapse to one more pass, not many

  The goal is:

  - local writes stay responsive
  - UI stays automatically updated shortly after writes
  - sync continues automatically in the background
  - long-running imports do not drown in their own reactive refreshes

  ### 8. Add lifecycle-aware subscription primitives

  Keep automatic UI updates, but provide safer tools for large or non-interactive workloads.

  Add options on subscriptions / query stores such as:

  - low-priority subscription mode
  - paused subscription mode
  - manual flush subscription mode for importer/background tooling
  - configurable refresh debounce window for local-mode stores

  Default UI usage remains automatic.
  Advanced/background usage can opt into lower refresh pressure without disabling correctness.

  ### 9. Add instrumentation and perf counters as first-class sync/runtime diagnostics

  Keep the current investigation logs, but turn the important parts into durable metrics/hooks.

  Expose:

  - write duration
  - reactive refresh duration
  - number of stores refreshed per table invalidation
  - queue depth / pending invalidations
  - upload queue depth
  - time from local write to subscriber notification
  - time from local write to push sent / push acknowledged
  - fatal runtime/storage state transitions

  This is necessary to validate that the new model actually scales to 1000+ local writes.

  ## Public API / Interface Changes

  Important additions:

  - bulk mutation API:
      - runWriteBatch(...) or equivalent
  - optional fast-path bulk/local manager APIs:
      - createManyLocal(...)
      - createLocalFast(...)
  - structured runtime/storage fatal error shape propagated through shared runtime client responses
  - query/subscription options for refresh scheduling policy
  - optional debug/perf hooks for sync/reactive timing

  Important behavioral changes:

  - notifyTableChanged() is no longer an immediate awaited refresh barrier
  - manager write APIs return after durable local mutation, not after subscriber refresh completion
  - reactive updates remain automatic but are coalesced and asynchronously flushed
  - sync remains automatic but no longer sits on the write hot path

  ## Test Plan

  ### Reactive correctness

  1. Local create/update/delete still updates subscribed UI automatically.
  2. Multiple writes in one tick produce one coalesced refresh.
  3. Batched writes produce correct final subscriber state with one flush at batch end.
  4. Cross-tab invalidation still updates peer-tab subscriptions automatically.

  ### Sync correctness

  1. Local eager writes still enqueue upload queue entries automatically.
  2. Upload drain still starts automatically when runtime is ready.
  3. Remote changes still apply automatically and notify subscribers after commit.
  4. Conflict handling and rollback still update subscribers correctly.

  ### Throughput / resilience

  1. Import-like workload of 1000 local creates completes without periodic restart.
  2. Active list subscription during the same workload does not cause unbounded write slowdown.
  3. Subscription refresh cost remains bounded as row count grows.
  4. First slow/fatal runtime/storage failure fails fast and does not degrade into hanging later requests.

  ### Runtime/storage safety

  1. OPFS failure surfaces structured fatal error immediately.
  2. Subsequent requests fail immediately from fatal state.
  3. No automatic destructive reset occurs in core.
  4. Existing local data is preserved across fatal runtime/storage failure.

  ## Assumptions

  - Automatic UI updates remain a hard requirement.
  - Automatic sync remains a hard requirement.
  - OPFS is the only acceptable local SQLite backend for important data.
  - Eventual-within-a-tick automatic updates are acceptable; synchronous inline refresh on every write is not.
  - Bulk/background workloads are first-class and must be supported without requiring consumers to manually disable reactivity.