# Issue 17: Collation Single Derivation Path

Architecture reference: `../architecture.md` sections 1 (audit findings), 5 (IR discipline); root causes in `../current-state.md` section 8

## What to build

Fix the "collation rules don't seem to be applied consistently" class of bugs at the root: exactly one code path derives regularized tokens, and the preview renders from the same tokens fed to CollateX.

One pure, synchronous function — `deriveCollationInput(witnesses, settings, rules) -> { perWitnessTokens, diagnostics }` — applies preprocessing options (case, punctuation, supplied text, whitespace) and regularization rules in a documented, stable order. Both the alignment run and the UI preview consume its output; the parallel computation is deleted. Rule matching becomes Unicode-correct for polytonic Greek.

## Where to start

- `app/src/lib/client/collation/collation-state.svelte.ts` — both current paths live here or are called from here: preview via `applyRegularization()` -> `regularizedTexts`, and collation input via `buildWitnessInputFromWitness()` -> `deriveRegularizedToken()`. Extract the new module (e.g. `regularization.ts`) beside it.
- `app/src/lib/client/collation/collation-worker-types.ts` and `collation.worker.ts` — the worker payload must carry the derived tokens, not re-derive them; if it re-derives today, that is the drift point to eliminate.
- `app/src/lib/client/collation/collation-runner.ts` — witness token extraction feeding derivation.
- Rules: project scope in project settings, verse scope in the collation document (see `../current-state.md` section 5) — storage unchanged; only application converges.

## Contract

- `deriveCollationInput` is pure and synchronous (usable from the UI thread for preview and for worker payload construction).
- Application order is documented in code: project-scope rules then verse-scope rules, each in list order; the preprocessing-vs-rules ordering is decided once and stated in code and UI help text.
- Regexes compile with the `u` flag; inputs are normalized to NFC before matching (unless existing data dictates otherwise — if so, document the choice in the module).
- `diagnostics` reports every rule that failed to compile or apply; no rule is ever silently skipped.
- The preview map is a projection of the actual collation input, not a re-computation.

## Out of scope

- Diagnostics UI, per-rule effect display, and staleness marking (issue 18) — this issue produces the `diagnostics` data; 18 renders it.
- New rule features (flags UI, non-regex rules).
- Alignment algorithm changes (`collatex-tsport` untouched).
- Punctuation-handling redesign beyond making current behavior consistent.

## Acceptance criteria

- [ ] `deriveCollationInput` exists; both preview and worker payload consume it; the old parallel derivation code is deleted (grep for `applyRegularization`/`deriveRegularizedToken` remnants).
- [ ] A regression test asserts preview tokens are identical to worker-submitted tokens for the same state.
- [ ] Unit tests cover application order, `u`-flag behavior, and NFC normalization with polytonic Greek fixtures (final sigma, breathings, iota subscript).
- [ ] Invalid-regex fixtures produce diagnostics entries, not silent skips.
- [ ] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/client/collation
bun run check && bun run test:unit -- --run
```

Success: collation suite passes with the new derivation and preview-equals-worker tests.

## Blocked by

None - can start immediately (issue 05 is Completed).
