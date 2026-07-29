# Ticket 11: Explain or remove the two unexplained workarounds

## Parent

`../INVENTORY.md` F31, F9, and § "What this inventory does not establish", point 3.

## What to build

Two pieces of code that suppress ProseMirror's own behaviour, with no comment, no linked issue, and no isolating commit. Nothing depends on either. Neither is understood.

**This ticket may legitimately end in "keep it, and write down why."** That is a success, not a failure. What is not acceptable is the present state, where they are unexplained *and* unremarked.

## Where to start

**F31 — six `handleDOMEvents` suppressions.** `transcriptionEditorSchema.ts:2557` blanket-returns `true` for `mousemove`, `mouseenter`, `mouseleave`, `dragover`, `dragenter` and `dragleave`, suppressing ProseMirror's own handling. Ticket 01 established that nothing in the editor's surroundings depends on them:

- `IiifWorkspace.svelte` holds no reference to the editor, the view, or any ProseMirror API — props and callbacks only.
- No component under `transcriptionEditor/` registers any of those six events. The only mouse handlers there are three `onmousedown`/`preventDefault` calls in `BubbleMenu.svelte` and `EditorToolbar.svelte`, about focus retention and unaffected.
- They arrived in `d52c168` ("v2 alpha commit"), a squashed import with no isolating history.

What ticket 01 did **not** establish is what they currently break. Returning `true` from these disables drag-selection and drop handling, so removing them changes behaviour — probably for the better, but that is a hypothesis.

**F9 — `EmptyLineTextInputStabilizer`.** `transcriptionEditorSchema.ts:1354`. Intercepts `handleTextInput` whenever the containing line is empty, dispatches its own `insertText`, sets the selection itself, and returns `true` to suppress ProseMirror. It is a third writer of the selection outside the causing transaction (`../SPEC.md` § A), on the hottest path there is, guarding a case ProseMirror handles natively.

The most likely explanation is that it compensates for the line-identity problems in F1 and F7 — in which case it should disappear once ticket 02 has landed. **Test that hypothesis directly:** disable it, run the editor specs, and see what fails.

## Contract

For each of the two, the ticket produces one of:

1. **Removed**, with a committed spec asserting the behaviour it was compensating for — now handled correctly by ProseMirror.
2. **Kept**, with a code comment naming what it compensates for, a spec that fails when it is removed, and a line in `TRACKER.md`.

Nothing else is acceptable. In particular, do not remove either one on the strength of "nothing references it" alone — that is what ticket 01 already established, and it is not sufficient.

Behaviour to characterise before touching F31: click-drag text selection across a line and across lines; drag-and-drop of text within the editor; drop of external text onto the editor; whether the bubble menu still appears after a drag-selection.

Behaviour to characterise before touching F9: typing the first character into an empty line, in a single-line column and in the middle of a multi-line column; the resulting caret position; whether an `appendTransaction` fires.

## Out of scope

- Any other `handleDOMEvents` entry not in the list of six.
- The selection-ownership work generally — ticket 03.
- Fixing whatever drag/drop deficiencies the characterisation turns up, if they are pre-existing and unrelated to the suppressions. Record them as new findings in `../INVENTORY.md` instead.

## Acceptance criteria

- [ ] A spec exists that characterises drag-selection and drop behaviour with the suppressions present.
- [ ] A spec exists that characterises first-character-into-empty-line behaviour with the stabilizer present.
- [ ] Each of the two is either removed with its characterisation spec still passing, or kept with a comment and a spec that fails on its removal.
- [ ] `TRACKER.md` records the decision and the evidence for each, in one or two sentences each.
- [ ] No finding is closed with the reasoning "nothing references it".
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm vitest run --project client src/lib/client
pnpm run check
pnpm run test:unit -- --run
```

Success: the characterisation specs pass in whichever state the ticket leaves the code, and `TRACKER.md` explains why that state was chosen.

## Blocked by

None - can start immediately. Worth doing after ticket 02 if F9's hypothesis is to be tested cleanly, since 02 is what would make it redundant.
