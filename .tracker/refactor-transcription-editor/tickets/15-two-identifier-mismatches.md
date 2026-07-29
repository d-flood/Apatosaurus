# Ticket 15: Two identifier mismatches — paragraph start and page name

## Parent

`../INVENTORY.md` F12, F46.

## What to build

Two fields read under a name that nothing writes. Each is a one-identifier fix; each silently produces a null or a missing value that looks like "the user did not set this".

- **F12** an editor-set paragraph start never reaches the TEI.
- **F46** every IIIF selection quote carries `pageName: null`.

They are one ticket because they are the same mistake and the same size, and because fixing one without auditing for the other wastes the lesson.

## Where to start

**F12** — `packages/tei-transcription/src/tei-serializer.ts:142`:

```js
rend: node.attrs?.paragraphStart ? (node.attrs?.teiAttrs?.rend || 'hang') : undefined,
```

The ProseMirror attribute is `'paragraph-start'` — hyphenated — in the schema (`transcriptionEditorSchema.ts:1500`) and in `toProseMirror` (`pm-adapter.ts:45`). `fromProseMirror` reads the hyphenated form correctly (`pm-adapter.ts:451`). Only the serializer reads `paragraphStart`, which is always `undefined` on a ProseMirror node.

A round-tripped document looks fine, because the original parse also stored `rend="hang"` in `teiAttrs` and `mergeTeiAttrs` re-emits it. But `toggleParagraphStart` (`TranscriptionEditor.svelte:800`) writes only `'paragraph-start'` and never touches `teiAttrs` — so a paragraph start set **in the editor** is silently dropped on export. Tagged assertion: `DEFECT F12` in `app/src/lib/tei/teiRoundTrip.svelte.spec.ts:114`.

**F46** — `app/src/lib/components/transcriptionEditor/editorInteractions.ts:76`, inside `getPageContextForPosition`:

```js
pageName: typeof node.attrs.n === 'string' && node.attrs.n.trim().length > 0 ? node.attrs.n.trim() : null,
```

The `page` node declares `pageName` (`transcriptionEditorSchema.ts:1058`), not `n`. There is no `n` attribute on `page`, so the ternary always falls through. A page with `pageName: "folio 1r"` yields a quote with correct text, page id and order — and a null name — weakening the context handed to `IiifWorkspace`.

## Contract

- The serializer reads the same spelling the schema writes. Fix the reader, not the schema: `'paragraph-start'` is the established spelling in three places and the serializer is the outlier.
- A paragraph start toggled in the editor and exported produces `rend="hang"` (or the existing `teiAttrs.rend` when one is present, preserving the current precedence).
- Round-tripping a document that already carried `rend="hang"` still produces byte-identical output — this fix must not double-write or change existing exports.
- `getPageContextForPosition` reads `pageName`.
- A selection quote from a named page carries that name.

While here, note the deeper problem for the record but **do not fix it**: the same concept has three spellings across three layers — `paragraphStart` (`TranscriptionDocument`), `'paragraph-start'` (ProseMirror), `rend="hang"` (TEI) — with no single place that maps between them. Add a comment at the serializer pointing at the other two spellings.

## Out of scope

- Unifying the three spellings behind one mapping layer. Worth doing, too big for this ticket; record it as a new finding in `../INVENTORY.md` if you scope it.
- Anything else in `IiifWorkspace` or the selection-quote payload.
- The `wrapped` attribute — ticket 16.

## Acceptance criteria

- [ ] Toggling paragraph start in a mounted editor and exporting produces `<lb … rend="hang"/>`.
- [ ] A document imported with `rend="hang"` and re-exported is byte-identical to the source.
- [ ] The `DEFECT F12` assertion is inverted in place.
- [ ] A selection on a page with `pageName: "folio 1r"` produces a quote carrying that name.
- [ ] `grep -rn "attrs\.n\b" app/src/lib/components/transcriptionEditor` returns nothing that refers to a page.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm run check
pnpm run test:unit -- --run
cd ../packages/tei-transcription && pnpm test
```

Success: the `DEFECT F12` assertion inverted and passing, a new assertion covering the page name, both suites green.

## Blocked by

None - can start immediately.
