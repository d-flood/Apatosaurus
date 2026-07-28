# Tracker for refactor-transcription-editor

## Purpose

This document tracks the status of all tickets in the refactor-transcription-editor epic: remove the ProseMirror/TipTap anti-patterns in the transcription editor that produce cursor-placement bugs, document corruption on Enter, broken framed-page layout, and O(document) per-keystroke cost. The epic's bias is **removal** — it should finish with less code than it started with.

Read `SPEC.md` first. It carries the investigation findings and measurements so they are not re-derived, and its § "Provisional Work Breakdown" holds the analysis for work not yet ticketed.

Then read `INVENTORY.md`. It is ticket `01`'s deliverable: 34 identified findings (`F1`–`F34`), the answers to the five questions tickets `03`–`05` were blocked on, and a coverage statement saying what was and was not read. Remaining tickets are to be written from it. It also corrects four claims in `SPEC.md`; those corrections are listed at its end.

## Current Status

Overall status: `In Progress`

Current ticket: none — `06` completed; downstream structural work is unblocked

Last updated: 2026-07-28

## Blocking Rules

- Ticket `01` is complete. Its inventory is the source for all remaining tickets — not `SPEC.md` § "Provisional Work Breakdown", which records analysis, not approved work.
- **Ticket `06` comes next and gates the structural work.** The app is not yet live, so nothing is ordered by data-loss urgency. The ordering principle is instead *confidence*: build the test net, then make changes in increasing order of blast radius. See "Sequencing" below.
- Tickets `03`–`05` are blocked on `01` (now satisfied) and should also wait for `06`: each is a behaviour-preserving refactor, and a behaviour-preserving refactor with no way to demonstrate preserved behaviour is a rewrite.
- Ticket `02` remains self-contained and can be done at any point. It is already covered by a tagged assertion in `transcriptionEditorStructuralCommands.svelte.spec.ts`.

## Sequencing

Ordered so that each stage is verified by the one before it, and the widest blast radius comes last.

1. **`06` — non-degenerate fixtures.** No production code. Everything downstream is verified against it. Expect it to surface findings; append them to `INVENTORY.md`.
2. **Dead code** (F28, F29, F30, F31, F34). Cannot change behaviour by definition — the code is unreachable or uncalled. Landing it early shrinks the surface before anything hard, and a green suite afterwards is a cheap check that `06`'s net is wired up. Two caveats: F31 and F9 are "nothing depends on this", *not* "we know why it was added" — establish what each compensated for first, or keep them and record that they are unexplained.
3. **Localized correctness fixes**, each independent and each already carrying a tagged assertion to flip: F5 + F10 (one bug, two sites — a `descendants` callback returning `false` stops the descent, not the walk), F12, F19, F20 (identifier and purity bugs, one line each), F3, F2, F18, F14, F6. Small diffs, no architectural change.
4. **Reproduce D2** before any performance work — see `INVENTORY.md` § "What this inventory does not establish", point 1. An input-rate test that outruns the repair, asserting the caret. If the caret does not jump, the theory is wrong and stage 5 changes.
5. **The performance path**: repair off the keystroke path (ticket `04`), then F23, F24, F26, F27. Hot paths change; the document model does not.
6. **Structural work**: line and column numbers become presentation (ticket `03` region, unblocked by `01`'s Q1), editorial chrome leaves `renderHTML`, then the layout model (ticket `05`, where F15/F16 land). Widest blast radius, deepest net underneath by this point.
7. **Decision point, not a ticket**: whether to move rich content out of node attributes (`SPEC.md` § D). `SPEC.md` already says to "re-evaluate whether it is worth doing at all… decide deliberately rather than by momentum". Give it a date and a written answer, either way.

Success is not "every ticket cleared". Some findings should end in a documented *no*.

## Ledger

| Number | Filename | Status | Depends On |
| --- | --- | --- | --- |
| 01 | `01-editor-code-quality-inventory.md` | Completed | None |
| 02 | `02-enter-no-longer-duplicates-the-column.md` | Not Started | None |
| 03 | `03-prosemirror-owns-cursor-placement.md` | Not Started | 01 |
| 04 | `04-structure-repair-leaves-the-keystroke-path.md` | Not Started | 01 |
| 05 | `05-page-and-column-layout-model.md` | Not Started | 01, 06 |
| 06 | `06-non-degenerate-test-fixtures.md` | Completed | 01 |

## Verification Baseline

Run from `app/` unless noted. Every ticket leaves this green:

```bash
pnpm run check
pnpm run test:unit -- --run
```

Editor-focused runs during development:

```bash
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm vitest run --project client src/lib/client/transcriptionEditorStructure.svelte.spec.ts
```

## Notes

- **2026-07-28** — Ticket `06` complete. Shared deterministic builders, model/DOM/attribute snapshots, and direct/mounted editor harnesses now live under `app/src/lib/client/testing/`; editor characterization specs use the layer and retain all 26 `DEFECT F<n>` tags. No new defect surfaced. Baseline increased from 97 files / 630 tests to 98 files / 637 tests.
- **2026-07-28** — Ticket `06` deleted `selection-stability.svelte.spec.ts`: its `simulatePageTracking` and `simulateIiifPageChange` helpers copied editor behavior into the test, while the correction-workspace scenario asserted a test-local boolean. It therefore tested its own simulation rather than a production path; the real initialization, editing, carrier insertion, mounted editor, and mounted correction/carrier paths remain covered by their focused specs.
- **2026-07-28** — Epic opened from a diagnosis session covering three reported bugs: click-to-position, cursor jump while typing, and framed-page horizontal scroll. A fourth defect was found during that session — `createLineSplitTransaction` duplicates every other line in a multi-line column on every Enter (ticket 02). It was found by **measurement, not reading**: the same code had already been read past without the defect being noticed.
- **2026-07-28** — The measurement harness is the `client` vitest project (Playwright/Chromium). A spec under `app/src/**/*.svelte.spec.ts` can mount a real editor and measure real layout, hit-testing and timing. Every number in `SPEC.md` came from it. Prefer executing over reasoning for anything touching transactions, geometry, or cost.
- **2026-07-28** — The audit behind `SPEC.md` covered roughly 2,500–3,000 of ~15,000 lines. § "What Was Not Investigated" lists the rest. Do not treat the anti-pattern inventory as closed; that is what ticket 01 is for.
- **2026-07-28** — Supersedes `.tracker/files-as-database/tickets/20-editor-selection-side-effects-and-harness.md`, whose stated cause (a debounce feedback loop in `editorInteractions.ts`) is not supported by measurement. Do not spend time there.
- **2026-07-28** — Ticket `01` complete. `INVENTORY.md` carries 34 findings (`F1`–`F34`) with location, evidence type, verdict and kind, plus a coverage statement. Summary follows.

### Ticket 01 findings summary

**Two defects need raising ahead of the epic**, both destroying a scholar's document, both one-line-ish fixes independent of everything else:

- **F6** — "Insert Page" replaces the *entire manuscript* with one empty page if the user has not clicked into the editor first. `insertContent` fits a block `page` node into the default selection and ProseMirror's fitter resolves the mismatch by replacing everything. Reproduced on a three-page fixture.
- **F14** — `initializeEditorContent`'s `setContent` is an undoable history event, and the history plugin groups the user's first keystroke with it. The first `Ctrl+Z` after opening a transcription empties the manuscript. Fix: `addToHistory: false`.

**The five blocked questions are answered.**

1. *Do `lineNumber`/`columnNumber` reach TEI?* No, in the sense that matters. `lineNumber` is never written to TEI at all and is recomputed positionally on import. `columnNumber` is written to `@n` but the parser discards any `@n` that is not `C<digits>` — which is exactly what the serializer emits — and renumbers by position. **Both attributes can be removed**, sequenced after F2.
2. *Do the `handleDOMEvents` suppressions serve `IiifWorkspace` or the inspector?* No. `IiifWorkspace` holds no editor/view/ProseMirror reference at all — props and callbacks only — which also closes the "IIIF write path into the editor" blind spot: there is none. No component in the directory registers any of the six events. **Delete all six.**
3. *Is `forcePageRender` dead?* Fully. `contentVisibility` appears only inside `forcePageRender` itself, which saves `''`, writes `visible`, restores `''`. **Delete.**
4. *Does the TEI round trip lose data?* Structure, text and unknown TEI attributes survive, and export is idempotent. Three losses: **F12** editor-set paragraph start never exported (the serializer reads `paragraphStart`, everything else writes `'paragraph-start'`); **F13** page- and column-level `wrapped` dropped because the schema declares it only on `line`; **F19** `lacunose`/`unclear` lose `teiAttrs` on render, affecting clipboard and correction previews.
5. *Undo/redo under appended transactions?* Sound. Appended repair/renumber transactions fold into the same history event; a typed character, a column split and an Enter each undo in one step. This narrows `SPEC.md` § D2 — repair's full-document replace moves the cursor but does **not** poison history. The load does (F14).

**Other correctness defects:** F2 (column split numbers the new column from the document-wide max, so every split provokes a whole-document repair replace), F3 (the split drops `zone`/`teiAttrs`, breaking framed pages), F5 and F10 (two `descendants` callbacks that `return false` after a match — which stops the descent, not the walk — so both return the *last* hit; F10 puts page labels and running titles into the page's bottom line), F7 (line/column ids do not exist until the first edit), F11 (Enter's uncancellable microtask selection write), F18 (`updateNodeAttrs` throws rather than fails on a stale position), F20–F22 (`renderHTML` mints ids on every render, emits a block `<div>` inside `<p>`, and computes a stale `hasFrameZones`).

**Layout — `SPEC.md` § D3's open caveat is closed.** **F15**: a blank framed page *does* overflow a 1000 px pane, and the cause is `min-w-max` on the editor root (`TranscriptionEditor.svelte:1356`), which removes the constraint `.page { min-width: fit-content }` clamps against. Deleting one Tailwind class removes the overflow. **F16 corrects `SPEC.md`**: `.column { min-width: 0 }` alone does *not* restore the three-across frame at 1000 px — the declared flex bases (56 rem) force the wrap regardless. Ticket `05` should replace the wrapping flex row rather than tune it.

**Performance beyond `SPEC.md` § B:** F23 (six full-document scans per selection change *and* per keystroke; four are avoidable outright because they look for ancestors), F24 (`fromProseMirror` runs twice per keystroke — both "debounced" helpers convert the whole document *before* setting their timer), F25 (`InlineCarrierWorkspace` re-implements the whole-document compare-by-`JSON.stringify` plus full-document replace at its own scale, so ticket `04`'s repair boundary must cover it too), F26, F27.

**Dead code to delete:** F28 `forcePageRender` (13 lines), F29 `restoreSelection`/`findLineStartPosition` (36 lines), F30 three unused exports in `tei-inspector-utils.ts` (~40 lines), F31 the six event suppressions, F34 `insertBreakNode` (no callers, and the `line` content expression would reject its output anyway).

**Three things the inventory does *not* establish**, written up in its § "What this inventory does not establish" so no ticket assumes them closed:

1. **D2's causal chain — cost → `DOMObserver` desync → caret jump — is still an inference.** The cost is measured; the link to the symptom is not. Ticket `03` should reproduce the jump *first* (an input-rate test that outruns repair, asserting the caret) and only then remove the cost, so the fix is verified against the symptom rather than the theory. Everything else in this inventory was found by execution; this has not met that standard, and it is the bug the scholar feels most often.
2. **The finding list is not proven complete.** F6, F10 and F14 were never reported and were found by executing ordinary user actions. Three unreported document-damaging defects in one pass is evidence the space is *not* exhausted. Likeliest remaining ground: the inspector write paths and clipboard behaviour — both mutate documents, neither has a non-degenerate test.
3. **F31 and F9 recommend deleting code whose original purpose is unknown.** Both are "nothing depends on this", not "we know why it was added and the reason is gone". Establish what each was compensating for, assert that behaviour, then remove — or keep them and record that they are unexplained.

**On removal discipline.** The epic's bias is removal, and that bias is a hazard as well as a guide. The test applied to every verdict: *would a scholar be able to record something before this change that they cannot record after?* One verdict failed it and has been rewritten — **F17** originally read "two metamark representations, pick one; the mark is cheaper to keep." They are not redundant: the mark emits `<metamark>text</metamark>`, the node emits `<metamark target="#mod1"/>` — a standalone scribal symbol pointing elsewhere, which has no text to wrap. Deleting either makes real manuscript content unrecordable. The actual defect is that the scholar never chooses; the editor infers the TEI construct from the incidental shape of the selection. **F13** (`wrapped` on page/column) is deliberately left as an explicit either/or so the cheap branch is not taken by default. Removing `lineNumber`/`columnNumber` was *checked* rather than assumed to be free: no UI writes them, the status bar already derives the line number positionally, and the normalizer overwrites any custom value on the next edit. Corollary worth its own ticket — a scholar currently has **no way** to record a scribe's own non-sequential line numbering; the TEI layer carries it in `teiAttrs.n`, nothing in the UI exposes it. That is a pre-existing gap, not a consequence of the change.

**Method notes for whoever works next.** The `client` vitest project does *not* load `app.css`, so a mounted component gets the Svelte `<style>` block but no Tailwind utilities; any layout measurement must inject `app.css?inline` first or its numbers are meaningless. `TranscriptionEditor.svelte` mounts cleanly in a spec and can be driven through its real toolbar and metadata dialog by `aria-label`, which is how the component-private commands were executed rather than re-implemented.

Eight new specs were committed under `app/src/`; all pass, and the baseline is green (`check`: 0 errors; unit suite: 630 tests across 97 files). Assertions encoding a finding are tagged `DEFECT F<n>` in the source so a fixing ticket can find the expectation to flip.
