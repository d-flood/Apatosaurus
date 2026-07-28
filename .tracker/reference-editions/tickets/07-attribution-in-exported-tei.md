# 07 — Attribution in the exported TEI header

## What to build

Render the editions-used set that ticket 04 records onto the transcription's exported TEI header, so that attribution travels with the published file.

Small slice, real obligation. Robinson-Pierpont is public domain and carries no requirement, but the moment ticket 06 ships a scholar can seed from a CC BY edition — including, quite plausibly, the 157 CC BY IGNTP files already bundled with this app. If they seed, review half of it, and publish, the published file contains CC BY material and owes attribution.

Demo: seed a transcription from an edition, export TEI, and find the edition named in the header's source description.

## Where to start

- The editions-used set on the transcription record, from ticket 04.
- The attribution string on each catalog entry, from ticket 04 (bundled) and ticket 06 (user-supplied).
- `app/src/lib/client/store/formats/tei.ts` — `transcriptionDocumentToTei` is where a transcription becomes TEI, passing record metadata through as export options.
- `app/src/lib/tei/tei-exporter.ts` and `packages/tei-transcription/src/tei-header-serializer.ts` — where the header is built.
- Schema: `NT_Manuscripts_TEI_Schema/document.xsd`. Validation prior art: `packages/tei-transcription/tests/tei-xsd.spec.ts` and `test-support/validate-igntp-xsd`.

## Contract

**Attribution comes from the editions-used set**, which is a set of edition identities with no ranges, and which never shrinks as text is edited. This is deliberate and is the reason record-level provenance exists alongside the per-text mark: the mark is designed to disappear, so it cannot carry an obligation that outlives it.

**Output goes in the header's source description**, one entry per edition, carrying the edition's attribution string.

**The export stays schema-valid** whether the set is empty, has one entry, or has several.

**An empty set produces no source-description addition at all** — not an empty element, not a placeholder. A transcription typed from scratch exports exactly as it does today.

**Do not attempt to describe which parts came from which edition.** Range-level provenance was considered and rejected: it goes stale the moment text is edited, split, or deleted.

## Out of scope

- The `<seg type="unconfirmed">` marking of unconfirmed text and its export warning. Tickets 02 and 03.
- Any change to how the editions-used set is recorded or when it is written. Ticket 04.
- Attribution display in the picker. Tickets 04 and 06.
- License compliance checking, or blocking export based on an edition's license.
- Changing any other part of the TEI header.

## Acceptance criteria

- [ ] Export spec: a transcription seeded from one edition names that edition in its exported header's source description.
- [ ] Export spec: a transcription seeded from two editions names both.
- [ ] Export spec: a transcription with an empty editions-used set exports a header byte-identical to today's output for the same record.
- [ ] Export spec: the edition remains named after all of its seeded text has been edited away.
- [ ] XSD suite passes for exports with zero, one, and several editions.

Commands:

```sh
cd packages/tei-transcription && pnpm run test
cd app && pnpm run check && pnpm run test:unit -- --run
```

Success = all exit 0.

## Blocked by

- 04 — the editions-used set and the attribution string on catalog entries.
