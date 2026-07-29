# Ticket 25: `<seg>` survives the round trip

## Parent

`../INVENTORY.md` R2.

## What to build

Two branches of `<seg>` parsing discard content silently. The model and serializer can both represent a `teiSpan` whose tag is `seg`, and the parser does not reject the input as unsupported — it accepts it and flattens it, which is the worst of the three options.

```xml
<seg type="rubric" cert="high"><w>alpha</w></seg>
<!-- becomes -->
<w>alpha</w>
```

```xml
<seg type="margin"><fw place="left"><w>note</w></fw><w>alpha</w></seg>
<!-- becomes -->
<seg type="margin"><fw place="left"><w>note</w></fw></seg>
```

The first loses the `<seg>` and every attribute on it. The second loses every non-`fw` sibling.

## Where to start

`packages/tei-transcription/src/tei-parser.ts:225`, `:936`, `:1708`.

- A generic segment with no immediate `fw` is unwrapped without applying a `teiSpan` mark.
- A segment with any immediate `fw` keeps only immediate `fw` children.

The serializer side already works: `tei-serializer.ts:415` renders a `teiSpan` wrapper with its tag and `teiAttrs`. So this is a parser gap, not a model gap — check that assumption early, because if the model does turn out to be short of something, the ticket is larger than it looks.

## Contract

- A `<seg>` with no `fw` child round-trips with its tag and every attribute intact, as a `teiSpan`.
- A `<seg>` mixing `fw` and non-`fw` children keeps **all** of them, in source order.
- Nesting is preserved: a `<seg>` inside a `<seg>` survives.
- Existing `<seg>`-with-`fw` behaviour that callers depend on is not broken. The marginalia path uses this shape; check `formworkConcepts.ts`'s classification before changing the branch it feeds.
- If any `<seg>` shape genuinely cannot be represented, the parser **says so** — a diagnostic, a thrown error, or a recorded unsupported-input list. Silent flattening is not an option this ticket may choose.

## Out of scope

- The `fw` content model — ticket 22. If that has landed first, `<seg>`-with-`fw` content handling may already look different; adapt rather than fighting it.
- `<seg>` rendering or any editor-side UI for it.
- Other wrapper elements, unless they share the exact same branch. If they do, fold them in and say so.

## Acceptance criteria

- [ ] `<seg type="rubric" cert="high"><w>alpha</w></seg>` round-trips byte-identically.
- [ ] `<seg type="margin"><fw place="left"><w>note</w></fw><w>alpha</w></seg>` round-trips with both children, in order.
- [ ] A nested `<seg>` round-trips.
- [ ] Existing marginalia fixtures pass unchanged.
- [ ] No `<seg>` input is accepted and silently altered; anything unsupported is reported.
- [ ] Both baselines pass.

```bash
cd packages/tei-transcription && pnpm test
cd ../../app
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: the three `<seg>` shapes round-trip byte-identically; marginalia fixtures unchanged; both suites green.

## Blocked by

None - can start immediately.
