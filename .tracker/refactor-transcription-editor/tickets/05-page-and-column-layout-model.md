# Ticket 05: Page and column layout model

## Parent

`../SPEC.md` § D3, § G.

## What to build

A framed page demands horizontal scroll long before its content warrants it, and its columns appear to grow as if padded. Decide where horizontal scrolling lives — the recommendation is *inside the column* — and make page and column sizing follow from that.

## Where to start

**Reproduce the reported case first.** A completely blank framed page did **not** overflow at any width tested from 1400 down to 600 px, because `fit-content` as a `min-width` clamps to available space. The reported blank-page scroll was never reproduced in isolation. The most likely explanation is a narrow editor pane with the IIIF workspace open (`flex-1 min-w-0`), which is where the 1664 px intrinsic demand below would tip over. Establish the conditions before changing anything; if it reproduces at full width with no viewer open, there is a contributor not yet identified and it must be found first.

Two rules in `app/src/lib/components/transcriptionEditor/TranscriptionEditor.svelte`'s style block fight each other:

```css
:global(.page)   { min-width: fit-content; }
:global(.column) { min-width: 20rem; }
```

**An empty framed page has a `max-content` width of 1664 px** — five columns × the 320 px floor, summed onto one hypothetical flex line, because `.frame-grid` is `flex-wrap: wrap` and a wrapping flex container's max-content size is the sum of all items as though nothing wrapped. A plain single-column page measures 352 px, which is correct.

**The frame collapses below ~1100 px.** `min-width: 20rem` clamps each zone's flex base size, so left (320) + center (384) + right (320) + gaps exceeds available width and the right column wraps to its own full-width row:

| Container | Visual rows |
| --- | --- |
| 1400 / 1200 px | `top` / `left + center + right` / `bottom` — correct |
| 1000 / 900 px | `top` / `left + center` / **`right`** / `bottom` — broken |
| ≤ 700 px | all five stacked |

Setting `.column { min-width: 0 }` restores the intended three-across frame at 1000 px and below.

**The page snaps outward nonlinearly.** At a 1200 px container, typing into the center column does nothing visible up to ~80 characters — the text spills, since `.page`, `.column` and `.line` are all `overflow: visible`. Then:

| Center column text | `.line-content` | Page width | Container `scrollWidth` |
| --- | --- | --- | --- |
| empty | 1 px | 1200 | 1200 |
| 80 chars | 443 px | 1200 | 1200 |
| 160 chars | 650 px | **1615** | **2016** |

The line is 650 px, but the page demanded ~965 px more than the container, because `fit-content` drags all five zones' minimums along with the one column that grew.

**Changes:**

- Replace `.column { min-width: 20rem }` with a floor that does not clamp the flex base — `flex-basis` plus `min-width: 0` — so zones shrink as intended and the frame survives narrow panes.
- Remove `.page { min-width: fit-content }`. The page sizes to its container.
- Give the column (or the line container inside it) `overflow-x: auto`, so a long line scrolls inside its own column and never widens the page or the document.
- Reconcile with the route's scroll container and mirrored sticky scrollbar in `app/src/routes/transcription/[id]/+page.svelte` — `scrollContainer`, `topScrollbar`, `topScrollInner`, `syncTopToContent`, `syncContentToTop`. Its `ResizeObserver` observes only `scrollContainer` and its *direct* children, so growth deeper in the tree may never update `topScrollInner`'s width. Once scrolling moves into the column, this mirror may be removable entirely — prefer deleting it to fixing it.
- Delete `forcePageRender` in `TranscriptionEditor.svelte`. It is a leftover hook from the reverted `content-visibility` experiment; ticket 01 question 3 confirms nothing sets `contentVisibility`.

Related markup, in `app/src/lib/client/transcriptionEditorSchema.ts`: `Page.renderHTML`'s `columnContainerClass`, `Column.renderHTML`'s `flex-1`, and `Line.renderHTML`'s `whitespace-nowrap` on `.line-content`.

Measurement harness: mount an editor in a `client`-project spec inside a fixed-width `overflow-x: auto` container, insert a framed page, and read `scrollWidth`/`clientWidth` and each column's `offsetWidth` and `getBoundingClientRect().top` (grouping columns by `top` gives the visual row layout). The tables above were produced this way.

## Contract

- A blank page of any kind produces no horizontal scroll at any pane width.
- The five-zone frame renders as top / left+center+right / bottom at every width where three columns fit, and degrades predictably below that.
- A long line scrolls within its column; page width and document width are unaffected by line length.
- Behaviour holds with the IIIF workspace both open and closed.

## Out of scope

- Moving editorial chrome out of `renderHTML` and making `.line-content` fill the line box — a later ticket, written from ticket 01's inventory.
- Virtualized scrolling. See `../SPEC.md` § On Virtualization.
- `triiiceratops` internals.

## Acceptance criteria

- [ ] The reported blank-page scroll conditions are reproduced and recorded in `TRACKER.md` Notes, or documented there as not reproducible.
- [ ] Blank framed page: `scrollWidth === clientWidth` at 1400, 1200, 1000, 900, 700 and 600 px.
- [ ] Frame row layout asserted at each of those widths, matching the contract.
- [ ] A 200-character line in the center zone changes neither page width nor container `scrollWidth`.
- [ ] The same assertions hold with the IIIF workspace open.
- [ ] `forcePageRender` no longer exists.
- [ ] Net change across the touched files is a reduction in lines.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm run check
pnpm run test:unit -- --run
git diff --stat -- src/lib/components/transcriptionEditor/TranscriptionEditor.svelte src/routes/transcription/\[id\]/+page.svelte
```

Success: the editor specs pass including the new layout tests; `check` and the unit suite pass; `git diff --stat` shows more deletions than insertions across the two files.

## Blocked by

- Ticket 01 (`01-editor-code-quality-inventory.md`) — its question 3 confirms `forcePageRender` is dead, and its read of `IiifWorkspace.svelte` establishes how the pane width is constrained when the viewer is open.
