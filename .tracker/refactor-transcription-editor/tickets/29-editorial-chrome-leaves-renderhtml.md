# Ticket 29: Editorial chrome leaves `renderHTML`

## Parent

`../SPEC.md` § A2 and § "Provisional Work Breakdown".

## What to build

`Line.renderHTML` emits the line-number gutter and the wrapped-arrow as `contenteditable="false"` siblings of the contentDOM, and `.line-content` is `inline-block; min-width: 1px`. Nothing fills the remaining space:

| Measurement | Value |
| --- | --- |
| `<p class="line">` box width | 844 px |
| `.line-content` (the contentDOM) width | 39 px |
| Dead zone — line area outside contentDOM | **770 px** |

This is the structural half of D1. Ticket 03 stops `handleClick` from overriding ProseMirror's hit-testing; **this ticket removes the reason the override seemed necessary.** Until the contentDOM fills the line, clicking past the end of the text lands outside the editable content and there is nothing for ProseMirror to resolve.

`Page.renderHTML` and `Column.renderHTML` do the same at their level: page header, label badge, running title, catchword/quire footer, column label.

## Where to start

`app/src/lib/client/transcriptionEditorSchema.ts` — `Line.renderHTML`, `Page.renderHTML` (`:987`), `Column.renderHTML`. Styles in `TranscriptionEditor.svelte`'s style block.

Ticket 28 has already made the line number a CSS counter, which is the mechanism the gutter needs. Ticket 03's click assertions are the ones to re-run — this is the change that should make them pass structurally rather than by special-casing.

## Contract

- `.line-content` fills the line's clickable area. Clicking anywhere on a line — including past the end of its text — resolves to a position inside the contentDOM.
- The gutter and the wrapped arrow become CSS pseudo-elements, driven by the counter from ticket 28 and a `data-wrapped` attribute. They are not elements inside the node's DOM.
- Page and column chrome become pseudo-elements driven by `data-*`, or Svelte chrome positioned **outside** the ProseMirror node DOM. Either is acceptable; mixing them is not.
- No `contenteditable="false"` sibling of a contentDOM remains in any of the three nodes.
- Clicking the gutter does not move the caret to the line start — it does whatever ProseMirror does for a click on a non-editable pseudo-element, which is nothing.
- Selection across lines still works, and a selection that spans the gutter region does not break.

## Out of scope

- `handleClick` itself — ticket 03 owns removing it. If 03 has already landed and left a narrowed version behind, this ticket should be able to delete the remainder; check, and say so.
- The frame layout — ticket 05.
- NodeViews — ticket 30.

## Acceptance criteria

- [ ] Measured dead zone on a line containing short text is under 5% of the line box width, down from 91%.
- [ ] Clicking at the far right of a line containing "Alpha" places the caret at the end of "Alpha", asserted through real hit-testing.
- [ ] `view.posAtCoords()` and `state.selection` agree after a click anywhere on the line.
- [ ] Clicking the gutter does not move the caret.
- [ ] The line number, wrapped arrow, page header, label badge, running title, catchword, quire footer and column label all still display, asserted in a mounted editor with real CSS.
- [ ] No `contenteditable="false"` element appears inside `Line`, `Page` or `Column` render output.
- [ ] Ticket 03's click assertions pass without line-specific special-casing.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor/transcriptionEditorLayout.svelte.spec.ts
pnpm vitest run --project client src/lib/client/transcriptionEditorRendering.svelte.spec.ts
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm run check
pnpm run test:unit -- --run
```

Layout and hit-testing assertions require `app.css?inline` injected in `beforeAll`.

Success: the dead zone is gone, clicks resolve naturally, all chrome still renders.

## Blocked by

- Ticket 28 (`28-line-and-column-numbers-become-presentation.md`) — the gutter is driven by the CSS counter it introduces.
- Ticket 03 (`03-prosemirror-owns-cursor-placement.md`) — its click assertions are this ticket's acceptance gate, and its `handleClick` removal is the behavioural half of the same defect.
