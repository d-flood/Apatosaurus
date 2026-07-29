# Ticket 01: Editor code-quality inventory

## Parent

`../SPEC.md` — in particular § "What Was Not Investigated", which lists what this ticket exists to close.

## What to build

A complete inventory of the transcription editor's anti-patterns, dead code, and defects, published as `.tracker/refactor-transcription-editor/INVENTORY.md`.

`SPEC.md` documents four confirmed defects and an anti-pattern inventory drawn from roughly 2,500–3,000 of ~15,000 lines. The rest was never read. This ticket reads it, executes the parts that cannot be verified by reading, and produces a finding list complete enough that the remaining epic tickets can be written from it.

The bias of this epic is **removal**: the expected output is a list of things to delete, simplify, or stop doing, not a list of things to build. Where a finding could be resolved either by adding a mechanism or by removing the thing that needed it, say so and recommend the removal.

This is an investigation ticket. It changes no production code. Its deliverable is a document plus, where the investigation required them, permanent regression tests.

## Where to start

Read `SPEC.md` first — its findings are established and must not be re-derived.

**The measurement harness is the important technique.** The `client` vitest project runs Playwright/Chromium, so a spec under `app/src/**/*.svelte.spec.ts` can mount a real editor and measure real layout, hit-testing and timing:

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor/<name>.svelte.spec.ts
```

The corruption defect in ticket 02 was found this way *after* the same code had been read past without the defect being noticed. Prefer executing over reasoning for anything touching transactions, geometry, or cost.

**Unread source, by size:**

- `app/src/lib/components/transcriptionEditor/IiifWorkspace.svelte` (1681)
- `app/src/lib/components/transcriptionEditor/EditorToolbar.svelte` (1132)
- `app/src/lib/components/transcriptionEditor/InlineCarrierWorkspace.svelte` (728) — only the editor lifecycle was read
- `app/src/lib/components/transcriptionEditor/formworkConcepts.ts` (533)
- `app/src/lib/components/transcriptionEditor/editorCommands.ts` (472)
- `app/src/lib/components/transcriptionEditor/TranscriptionMetadataDialog.svelte` (464)
- `app/src/lib/components/transcriptionEditor/CorrectionWorkspace.svelte` (245)
- `app/src/lib/components/transcriptionEditor/tei-inspector-utils.ts` (223)
- `app/src/lib/client/transcriptionEditorBadgeIcons.ts` (206)
- the inspector components (`TeiNodeInspector`, `TeiAtomInspector`, `TeiWrapperInspector`, `SimpleCarrierInspector`, `FormWorkInspector`, `MetamarkInspector`, `EditorialActionInspector`, `CorrectionNodeInspector`, `InspectorHost`)
- `packages/tei-transcription` — owns `toProseMirror`/`fromProseMirror`, both on the autosave hot path
- `app/src/lib/client/transcriptionEditorSchema.ts` — roughly 60% unread: all inline atom nodes and marks (lines ~1–560 and ~1565–2420 as of 2026-07-28)

**Transaction functions to execute, not read.** `createColumnSplitTransaction` and `createEmptyLineInsertTransaction` (believed correct — confirm); `findLineStartPositionById` with absent and duplicated ids; everything exported from `editorCommands.ts`; and in `TranscriptionEditor.svelte`: `insertUntranscribed`, `updatePageFormWork`, `insertPage`, `insertFramedPage`, `insertColumn`, `toggleWordWrapped`, `toggleParagraphStart`, `deletePage`, `updatePageName`; and `InlineCarrierWorkspace`'s `replaceEditorDocument`/`syncNormalizedEditorDoc`/`emitContent`.

Existing harnesses worth reusing: `InspectorTestHarness.svelte`, `ToolbarInsertionHarness.svelte`, and the mounting pattern in `app/src/lib/client/transcriptionEditorStructure.svelte.spec.ts`.

**Specific questions that later tickets are blocked on:**

1. Does TEI export read `lineNumber`/`columnNumber` from node attributes, or recompute them from position? (Blocks removing those attributes.) See `packages/tei-transcription` and `fromProseMirror`.
2. Do any of the six `handleDOMEvents` suppressions (`mousemove`, `mouseenter`, `mouseleave`, `dragover`, `dragenter`, `dragleave`) exist to serve `IiifWorkspace` or the inspector drawer? (Blocks deleting them.)
3. Does anything still set `contentVisibility`, or is `forcePageRender` fully dead?
4. Does the TEI round trip lose data? Are there attributes parsed but never rendered, or rendered but never parsed?
5. What is undo/redo behaviour under the current appended transactions?

## Contract

`INVENTORY.md` contains, for every finding:

- a stable identifier (`F1`, `F2`, …) that later tickets can cite;
- the file and symbol it lives in;
- how it was established — **read**, **executed**, or **measured** — and for measured findings, the number;
- a verdict: **delete**, **simplify**, **replace**, or **keep**, with one line of reasoning;
- whether it is a correctness defect, a performance problem, or a maintainability problem.

It also contains a **coverage statement**: which files were read in full, which were skimmed, and which remain unread, so the next reader knows what the document does and does not cover. Do not claim completeness that was not achieved.

Findings that are correctness defects get enough detail to reproduce — a fixture and the wrong output, in the style of `SPEC.md` § D4.

Any regression test written during the investigation is committed as a permanent spec under `app/src/`, not left as a scratch file.

## Out of scope

- Fixing anything. Findings that are trivially fixable still go in the inventory; resist fixing them inline. The exception is a defect as severe as ticket 02's, which should be raised immediately rather than filed.
- Writing the follow-on tickets. That happens after this ticket, from the inventory.
- `triiiceratops` (the IIIF viewer package) internals, collation, and the TEI file format itself.
- Re-deriving anything already in `SPEC.md`.

## Acceptance criteria

- [ ] `.tracker/refactor-transcription-editor/INVENTORY.md` exists, with every finding carrying an identifier, location, evidence type, and verdict.
- [ ] Every file listed under "Unread source" above is either read in full or explicitly listed as still-unread in the coverage statement.
- [ ] Every transaction function listed under "Transaction functions to execute" has been executed against a multi-line, multi-column, multi-page fixture, and the result recorded.
- [ ] All five specific questions above are answered in `INVENTORY.md`.
- [ ] Any regression tests written are committed under `app/src/` and pass.
- [ ] A findings summary is appended to `TRACKER.md` Notes.
- [ ] Baseline passes.

```bash
cd app
pnpm run check
pnpm run test:unit -- --run
```

Success: `check` reports no errors; the unit suite passes with any new specs included.

## Blocked by

None - can start immediately. This is the epic's priority ticket.
