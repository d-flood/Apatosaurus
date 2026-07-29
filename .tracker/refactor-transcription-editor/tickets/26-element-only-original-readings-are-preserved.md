# Ticket 26: Element-only original readings are preserved

## Parent

`../INVENTORY.md` R3.

## What to build

When an apparatus also has correction readings, `hasReadingContent` decides whether the original exists using only `rdg.textContent.trim()`. An original containing just an atom — `<gap>`, `<space>`, `<milestone>` — has no text content, so it is classified as empty and replaced by `correctionOnly`:

```xml
<!-- input -->
<app>
  <rdg type="orig"><gap reason="lost" unit="chars" extent="3"/></rdg>
  <rdg type="corr" hand="c1"><w>abc</w></rdg>
</app>

<!-- output -->
<app>
  <rdg type="orig" hand="firsthand"/>
  <rdg type="corr" hand="c1"><w>abc</w></rdg>
</app>
```

The gap is deleted. "The original reading was a three-character lacuna" and "there was no original reading" are different scholarly claims, and the first is being silently converted into the second.

## Where to start

`packages/tei-transcription/src/tei-parser.ts:621` and `:1327` (`hasReadingContent` and its caller), `tei-serializer.ts:448` (`exportCorrectionNode`, which emits the `correctionOnly` shape).

The bug is the emptiness test, not the `correctionOnly` representation — that representation is correct for a genuinely absent original, and must keep working.

## Contract

- A reading is empty only when it has **no** text and **no** element children. An element-only reading is a present reading.
- `<gap>`, `<space>`, `<milestone>` and any other atom the model supports count as content.
- A genuinely empty `<rdg type="orig"/>` still produces the `correctionOnly` shape. Assert this explicitly — it is the case the current code gets right, and the easiest thing to break.
- The atom inside a preserved original round-trips with all of its attributes.
- Whitespace-only text content continues to count as empty.

## Out of scope

- The `correctionOnly` representation itself.
- Arbitrary attributes on `gap` and untranscribed carriers — ticket 27, though the two will touch adjacent code. If ticket 27 has landed, the preserved `<gap>` here should keep its full attribute set as a result; assert that.
- Correction workspace UI — ticket 21.

## Acceptance criteria

- [x] An `<app>` whose original is a lone `<gap>` round-trips with that gap intact.
- [x] The same for `<space>` and `<milestone>`.
- [x] A genuinely empty original still produces `<rdg type="orig" hand="firsthand"/>`.
- [x] A whitespace-only original is still treated as empty.
- [x] An original mixing an atom and text round-trips with both.
- [x] Existing correction fixtures pass unchanged.
- [x] Both baselines pass.

```bash
cd packages/tei-transcription && pnpm test
cd ../../app
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: element-only originals survive, genuinely empty ones still collapse, existing fixtures untouched.

## Blocked by

None - can start immediately.

## Implementation note — 2026-07-28

The code does not match the ticket's implementation premise. Changing
`hasReadingContent` to recognize element children prevents an element-only
original from becoming `correctionOnly`, but it does not preserve the
apparatus: `processContainerContent` applies the correction mark only to text.
`GapItem`, `SpaceItem`, and `TeiMilestoneItem` cannot carry marks in `LineItem`,
and both ProseMirror adapter directions serialize those atoms without marks.
The atom would become standalone and the corrector readings would disappear.

Implementing the contract therefore requires a representation decision that
the ticket does not make and its out-of-scope section appears to forbid. For
example, either atom items and their ProseMirror nodes must gain correction
marks, or the correction-only representation must become an apparatus node
that can also hold original content. Status set to `Needs Human Validation or
Intervention`; no production code or tests were changed.

## Accepted decision — 2026-07-28

Inline atom items and their ProseMirror nodes may carry correction marks. The
serializer treats consecutive words and atoms carrying the same correction
mark as one apparatus locus, so element-only and mixed original readings stay
attached to their correction readings. `correctionOnly` remains the
representation for a genuinely absent original. Carrier attributes continue
through the ticket `27` named-field plus `teiAttrs` representation.

## Verification — 2026-07-29

- `pnpm vitest run tests/tei-transcription.spec.ts`: 65/65 passed.
- Runnable package suites: 108/108 passed; package typecheck passed.
- `pnpm test`: 109 passed and the same seven documented infrastructure
  failures remain (six absent kitchen-sink fixtures and their corpus audit).
- Mounted app round trip: 20/20 passed.
- App `check`: 0 errors, one existing triiiceratops accessibility warning.
- App baseline: 105 files / 711 tests passed.
