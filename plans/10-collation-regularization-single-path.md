# Phase 10: Collation Regularization Single Path

Status: Not Started
Depends on: Phase 05
Architecture reference: `architecture.md` sections 1 (audit findings), 5 (IR discipline)

## Goal

Fix the "collation rules don't seem to be applied consistently" class of bugs at the root: exactly one code path derives regularized tokens, the preview renders from the same tokens fed to CollateX, and rule errors are surfaced instead of silently skipped.

## Scope

1. Single derivation pipeline in `collation-state.svelte.ts` (or extracted module `regularization.ts`):
   - One pure function `deriveCollationInput(witnesses, settings, rules) -> { perWitnessTokens, diagnostics }` that applies preprocessing options (case, punctuation, supplied text, whitespace) and rules in a documented, stable order.
   - The alignment run (`buildWitnessInputFromWitness` path) and the UI preview (`regularizedTexts` / `applyRegularization` path) both consume this function's output. Delete the parallel computation; the preview map becomes a projection of the actual collation input, not a re-computation.
2. Rule diagnostics:
   - Invalid regex: compile once at rule save/edit time; show the error inline in the rules UI (`RegularizationPhase.svelte`, `AlignmentGrid.svelte` sidebar). At collation time, an invalid rule is reported in `diagnostics` and shown, never silently skipped.
   - Per-rule effect visibility: for the current verse, show which tokens each enabled rule changed (cheap: diff of before/after during derivation). This turns "rules don't seem applied" into an inspectable answer.
3. Rule semantics hardening:
   - Document and stabilize application order: project-scope rules then verse-scope rules, each in list order; preprocessing before/after rules decided once and documented in code and UI help text.
   - Unicode correctness for Greek: compile with `u` flag; normalize inputs (NFC/NFD choice documented - Greek diacritics make this consequential; pick NFC unless existing data dictates otherwise) before matching. Add fixtures with polytonic Greek covering final sigma, breathings, and iota subscript.
4. Staleness correctness:
   - Any change to rules/settings marks current alignment stale with a visible "re-run needed" state (instead of a preview that no longer matches the table). Re-run keeps the existing warning about manual alignment loss.
5. Tests: unit tests for the derivation pipeline (order, flags, normalization, diagnostics) plus a regression test asserting preview tokens are identical to worker-submitted tokens for the same state.

## Non-Goals

- New rule features (flags UI, non-regex rules) - note ideas in Notes if they arise.
- Alignment algorithm changes (`collatex-tsport` untouched).
- Punctuation-handling redesign beyond making current behavior consistent and visible (the `ideas.md` punctuation issue gets easier after this, but is separate).

## Design Notes

- The worker payload (`collation.worker.ts` / `collation-worker-types.ts`) should carry the derived tokens, not re-derive; if it currently re-derives, that is the drift point to eliminate.
- Keep `deriveCollationInput` pure and synchronous so it is trivially testable and usable from both the UI thread (preview) and worker payload construction.
- Persisted rules live in project settings (project scope) and collation document (verse scope) - unchanged; only application converges.

## Checklist

- [ ] Single `deriveCollationInput` consumed by both preview and collation run
- [ ] Parallel derivation code deleted
- [ ] Invalid-regex surfaced at edit time and in run diagnostics
- [ ] Per-rule effect display for current verse
- [ ] Application order + normalization documented and tested (Greek fixtures)
- [ ] Rules/settings changes mark alignment stale visibly
- [ ] Preview-equals-worker-input regression test
- [ ] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

For any state, the tokens shown in the regularization preview are provably (by test) the tokens collated. A user can see why any given rule did or did not affect a token.

## Verification

```bash
cd app
bun run test:unit -- --run src/lib/client/collation
bun run check && bun run test:unit -- --run
```

## Notes

| Date | Note |
| --- | --- |
