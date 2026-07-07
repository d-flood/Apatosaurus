# Issue 18: Collation Rule Diagnostics and Staleness

Architecture reference: `../architecture.md` section 1 (audit findings)

## What to build

Make rule behavior inspectable and alignment staleness visible:

1. **Edit-time validation**: invalid regexes are caught when a rule is saved or edited, with the error shown inline in the rules UI.
2. **Run-time diagnostics**: at collation time, an invalid rule is reported from issue 17's `diagnostics` and shown to the user — never silently skipped.
3. **Per-rule effect visibility**: for the current verse, show which tokens each enabled rule changed (a before/after diff captured during derivation). This turns "rules don't seem applied" into an inspectable answer.
4. **Staleness**: any change to rules or collation settings after an alignment run marks the current alignment stale with a visible "re-run needed" state, instead of a preview that no longer matches the table. Re-run keeps the existing warning about manual alignment loss.

## Where to start

- `app/src/lib/components/collation/RegularizationPhase.svelte` and `AlignmentGrid.svelte` (sidebar) — where rule editing and inline errors render.
- Issue 17's `deriveCollationInput` `diagnostics` output — extend it with per-rule token-change records if 17 didn't already capture them (cheap: diff before/after per rule during derivation).
- `app/src/lib/client/collation/collation-state.svelte.ts` — where settings/rules changes and the alignment snapshot meet; staleness is derived state there.

## Contract

- Rule save/edit compiles the pattern (with `u` flag, matching issue 17) and blocks-or-flags invalid rules inline; the stored rule set may contain invalid rules, but they are always visibly marked.
- Per-rule effects are computed during derivation, not by re-running rules in the UI (no second application path — that is the bug class issue 17 removed).
- Staleness is a pure predicate of (settings/rules state at last run) vs (current state); tested independent of components.

## Out of scope

- Changes to derivation order or normalization (fixed in issue 17).
- New rule features, rule import/export.
- Collation undo/redo (in `ideas.md`, triaged in issue 23).

## Acceptance criteria

- [ ] Saving an invalid regex shows an inline error at the rule; the rule is marked invalid in the list.
- [ ] Running collation with an invalid rule present surfaces a visible diagnostic naming the rule.
- [ ] For a verse, each enabled rule's changed tokens are displayable; a rule with no effect shows as such (component test with fixtures).
- [ ] Editing rules/settings after a run flips the visible stale state; re-running clears it (state test).
- [ ] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/client/collation
bun run check && bun run test:unit -- --run
```

Success: collation suite passes with diagnostics and staleness tests.

## Blocked by

- 17 (`17-collation-single-derivation-path.md`) — diagnostics data and single-path guarantee.
