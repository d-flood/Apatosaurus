# Ticket 22: Formwork content lives in the document

## Parent

`../SPEC.md` § D; `../INVENTORY.md` F42, F25, F32.

## What to build

`fw` is an atom node whose content is a JSON string in an attribute. Make it a **content-holding node** that ProseMirror owns.

This is the largest ticket in the epic and it was chosen deliberately over the cheap alternative. The cheap alternative — make `FormWorkInspector` merge rather than replace, as ticket 21 does for its two surfaces — stops the bleeding and leaves the cause. The cause is that content stored as a string must be parsed, re-derived into a form, and rewritten on every edit, and every surface that does so loses what its form does not model.

Three consequences disappear with the data model, not with a patch:

- **F42** — every non-marginal `fw` is edited through a plain text field, and Apply replaces its content with `buildPlainTextFormWorkContent(textValue)` even when only metadata changed. Executed: a header carrying a `foreign` wrapper with `xml:lang`, an embedded line break and a correction apparatus was reduced on Apply to `<fw type="header" rend="center"><w>x</w></fw>`.
- **F25** — `InlineCarrierWorkspace.svelte` exists to run a **second** `Editor` instance over that string, hand-synchronised with the parent by comparing `JSON.stringify` snapshots and replacing the whole sub-document. It re-implements whole-document repair at its own scale, and its correctness rests on every parent echoing each `onChange` back — enforced by nothing.
- **F32** — five inspectors plus that workspace implement "has this changed?" as a string comparison, because a string is the only identity available.

## Where to start

Read in this order:

1. `../SPEC.md` § D and § E — why this is the shape it is.
2. `app/src/lib/client/transcriptionEditorSchema.ts`, the `fw` node and the 51 `JSON.stringify` call sites.
3. `app/src/lib/components/transcriptionEditor/InlineCarrierWorkspace.svelte` — the whole file. `syncNormalizedEditorDoc` (`:166`), `replaceEditorDocument` (`:321`), `emitContent` (`:159`), and the `$effect` at `:598` that pushes `initialContent` back whenever the snapshot differs.
4. `app/src/lib/components/transcriptionEditor/FormWorkInspector.svelte:38`, `:65`; `formworkContent.ts:8`.
5. `packages/tei-transcription/src/tei-parser.ts:868` — what the parser already admits inside an `fw`: marks, correction apparatus, break carriers, atoms, structured wrappers.
6. `app/src/lib/components/transcriptionEditor/inlineCarrierWorkspace.svelte.spec.ts` — the behaviour that must survive.

## Contract

- `fw` becomes a node with a content expression admitting the inline content the parser already produces. Its `content` attribute goes.
- **`teiAttrs` stays an attribute.** It is a flat bag of TEI attribute values, not content. Do not move it.
- Editing `fw` content is ordinary editing: undo works per keystroke, marks apply, search finds the text, and no snapshot comparison is involved.
- The nested `Editor` instance in `InlineCarrierWorkspace` is **removed**, not adapted. If it survives this ticket, the ticket has not been done.
- A one-way migration converts stored documents at load, coordinated with the document-entry boundary ticket 04 establishes. Migration is idempotent: running it on an already-migrated document is a no-op.
- **TEI export is byte-identical over a corpus sample before and after.** This is the acceptance gate. Take the sample first, from real files, and keep it in the repo.
- `FormWorkInspector` edits attributes only. It no longer touches content, so it cannot flatten it.
- Correction payloads (`correctionNode.corrections`, the `correction` mark) are **explicitly deferred**. `../SPEC.md` § D names them as a possible follow-on; decide after this lands, with evidence from having done `fw`.

## Out of scope

- Correction payloads, per the contract above.
- `teiAttrs` anywhere.
- The two inspector surfaces ticket 21 covers.
- NodeViews — ticket 30. This ticket changes where content lives; that one changes how nodes render.
- Any new formwork feature.

## Acceptance criteria

- [ ] A corpus sample of real TEI files is committed, and export is byte-identical for every one of them before and after the change.
- [ ] An `fw` containing a `foreign` wrapper, a line break and a correction apparatus survives an inspector metadata edit with all three intact.
- [ ] Typing inside an `fw` produces one undo step per keystroke group, not one per whole-content replacement.
- [ ] A mark applied inside `fw` content persists through save and reload.
- [ ] `InlineCarrierWorkspace.svelte` no longer constructs an `Editor`.
- [ ] `grep -c "JSON.stringify" app/src/lib/client/transcriptionEditorSchema.ts` is materially lower than 51; record the before and after in `TRACKER.md`.
- [ ] The migration is idempotent, asserted by running it twice.
- [ ] A document stored in the old shape loads correctly.
- [ ] Every assertion in `inlineCarrierWorkspace.svelte.spec.ts` either still passes or is replaced by one asserting the same user-visible behaviour through the new model.
- [ ] Both baselines pass.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor/inlineCarrierWorkspace.svelte.spec.ts
pnpm vitest run --project client src/lib/tei/teiRoundTrip.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
cd ../packages/tei-transcription && pnpm test
```

Success: byte-identical export over the corpus sample, the nested editor gone, both suites green.

**If the corpus comparison is not byte-identical, stop.** Do not adjust the expectation to match the new output — the difference is the finding, and it belongs in `TRACKER.md` before anything else happens.

## Blocked by

- Ticket 04 (`04-structure-repair-leaves-the-keystroke-path.md`) — the migration hangs off the document-entry boundary it establishes, and `../INVENTORY.md` F25 records that 04's repair boundary must cover `InlineCarrierWorkspace` too.
