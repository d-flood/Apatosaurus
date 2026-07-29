# Ticket 27: `gap` and untranscribed carriers keep arbitrary TEI attributes

## Parent

`../INVENTORY.md` R4.

## What to build

The dedicated `gap` and untranscribed models project only their displayed fields instead of carrying an attribute bag, so anything else on the source element is dropped:

```xml
<gap reason="lost" unit="chars" extent="2" cert="low" xml:id="g1"/>
```

loses `cert` and `xml:id`, and

```xml
<note type="untranscribed" reason="damage" extent="partial" resp="#ed" cert="low" xml:id="u1"/>
```

loses `resp`, `cert` and `xml:id`.

The `reason`/`extent` → `subtype`/`n` canonicalization is **intentional** and stays. Only the missing arbitrary attributes are the defect.

## Where to start

`packages/tei-transcription/src/tei-parser.ts:1402` and `:1517`; the models at `types.ts:104` and `:181`; the serializer at `tei-serializer.ts:179` and `:231`.

The pattern to copy already exists in this codebase and is known to work: `<pb>`, `<cb>` and `<lb>` carry a `teiAttrs` bag and survive the round trip intact, verified by `../INVENTORY.md` Q4. Make these carriers consistent with those rather than inventing a mechanism.

## Contract

- Both carriers gain a `teiAttrs` bag holding every attribute not already modelled by a named field.
- The existing named fields keep their current names and their canonicalization. `reason` and `extent` continue to map to `subtype` and `n`.
- No attribute is written twice — an attribute captured by a named field does not also appear in `teiAttrs`.
- Round trip is byte-identical for both elements with a full attribute set.
- Export attribute **order** is stable, so the round-trip comparison is meaningful. If order currently depends on object key insertion, pin it.
- The editor schema declares `teiAttrs` on the corresponding nodes, so the bag survives a pass through the editor — otherwise this repeats F13, where three layers carried a value the fourth discarded. **Check this explicitly; it is the likely way to get the ticket half-done.**

## Out of scope

- The inspector forms for these nodes. Ticket 21 makes `SimpleCarrierInspector` merge rather than replace, which is what stops an edit from deleting the new bag — the two tickets are complementary and neither is sufficient alone. Note in `TRACKER.md` if you land this one first, because until 21 lands an inspector edit will still wipe the bag.
- Other carriers not named here.
- Any UI for editing these attributes.

## Acceptance criteria

- [ ] `<gap reason="lost" unit="chars" extent="2" cert="low" xml:id="g1"/>` round-trips byte-identically.
- [ ] `<note type="untranscribed" reason="damage" extent="partial" resp="#ed" cert="low" xml:id="u1"/>` round-trips byte-identically.
- [ ] The `reason`/`extent` canonicalization is unchanged, asserted by an existing test.
- [ ] No attribute appears twice in the output.
- [ ] Both round trips survive a pass **through the editor**, not just through the parser and serializer.
- [ ] Existing gap and untranscribed fixtures pass unchanged.
- [ ] Both baselines pass.

```bash
cd packages/tei-transcription && pnpm test
cd ../../app
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: both elements round-trip byte-identically including through the editor; canonicalization unchanged.

## Blocked by

None - can start immediately.
