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

- [ ] An `<app>` whose original is a lone `<gap>` round-trips with that gap intact.
- [ ] The same for `<space>` and `<milestone>`.
- [ ] A genuinely empty original still produces `<rdg type="orig" hand="firsthand"/>`.
- [ ] A whitespace-only original is still treated as empty.
- [ ] An original mixing an atom and text round-trips with both.
- [ ] Existing correction fixtures pass unchanged.
- [ ] Both baselines pass.

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
