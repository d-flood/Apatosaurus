# Ticket 14: `renderHTML` becomes pure and inline-valid

## Parent

`../SPEC.md` § E; `../INVENTORY.md` F19, F20, F21, F22.

## What to build

Four defects in the schema's render path. They belong together because they are all "`renderHTML` is doing something a pure serialization function must not do", and because they are all covered by one spec file.

- **F19** `lacunose` and `unclear` drop their `teiAttrs` on render.
- **F20** `correction`, `correctionNode` and `abbreviation` mint a new id on every render.
- **F21** the `correction` and `abbreviation` marks emit a block `<div>` inside `<p class="line">`.
- **F22** `Page.renderHTML` computes `hasFrameZones` from its children once and never re-runs it.

## Where to start

All in `app/src/lib/client/transcriptionEditorSchema.ts`. The tagged assertions are in `app/src/lib/client/transcriptionEditorRendering.svelte.spec.ts` at `:42`, `:76`, `:99`, `:124`.

**F19** (`:249`, `:292`):

```js
'data-tei-attrs': JSON.stringify(HTMLAttributes.teiAttrs || {}),
```

`HTMLAttributes` holds already-rendered attributes — the key there is `data-tei-attrs`, never `teiAttrs` — so this always yields `'{}'`, and because it is written after the `...HTMLAttributes` spread it overwrites the correct value. Every other mark of the family gets it right via `renderTeiAttrMark` (`:146`) reading `mark.attrs.teiAttrs`. Only these two hand-written marks are wrong.

**F20** (`:498`, `:526`, `:584`, `:615`, `:648`, `:709`): `renderHTML` falls back to `nanoid(8)` when the id attribute is null. Two renders of identical content produce different HTML; the generated id is never written back, so it differs again next time, and `parseHTML` reading it back invents identity the document never had.

**F21** (`:502`, `:664`, `:683`): both inline marks wrap content in `['div', { class: 'tooltip' }, …]` for a DaisyUI tooltip. A `div` is neither valid inside a `p` nor inline, so a corrected or abbreviated word cannot participate in the line's inline layout — which is exactly the layout `../SPEC.md` § A2 and § G3 are about.

**F22** (`:987`): `renderHTML` iterates the page's children to choose between `frame-grid` and `flex gap-4`, but ProseMirror does not re-run a node's `renderHTML` when its children change. Giving a column a `zone` updates `data-zone` on the column and leaves the container class stale, so the frame layout does not appear until the page is rebuilt for an unrelated reason.

## Contract

- **`renderHTML` is pure.** Same node, same output, every time. No `nanoid`, no `Date`, no randomness, no reads of anything outside the node.
- Ids are assigned when the node is **created** — in the command or input rule that inserts it — not when it is drawn. A node that reaches `renderHTML` without an id renders without one; it does not invent one.
- `renderHTML` stays the serialization path. `parseHTML`, clipboard and `renderCorrectionContent`'s `generateHTML` all depend on it, and a test asserts `parseHTML(renderHTML(node))` round-trips.
- The `correction` and `abbreviation` marks render an **inline** element. The tooltip is driven by CSS or a decoration, not by a block wrapper.
- A parent does not derive a class from its children in `renderHTML`. `hasFrameZones` becomes a CSS concern on the container — `:has(> .column[data-zone])` needs no document state and no plugin.
- `lacunose` and `unclear` read `mark.attrs.teiAttrs`, like the other five marks.

## Out of scope

- Adding NodeViews. Ticket 30 owns that, and it is blocked by this one — `renderHTML` has to be correct before anything is layered over it.
- The wider frame layout work — ticket 05. This ticket only stops the class from going stale; it does not redesign `.frame-grid`.
- Moving rich content out of attributes — ticket 22.

## Acceptance criteria

- [ ] `lacunose` and `unclear` render their real `teiAttrs`, and a clipboard round trip preserves them.
- [ ] Rendering the same `correction` / `correctionNode` / `abbreviation` node twice produces identical HTML, asserted by string equality.
- [ ] No `nanoid` call remains inside any `renderHTML`.
- [ ] Inserting one of those nodes assigns its id at creation time, and the id is present in the document JSON.
- [ ] The `correction` and `abbreviation` marks emit no `div`; the rendered element is inline, asserted via `getComputedStyle` in a mounted editor.
- [ ] A corrected word sits on the same line box as its neighbours.
- [ ] Adding a `zone` to a column of an already-rendered page makes the frame layout appear without any other document change.
- [ ] All four tagged assertions are inverted in place.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/client/transcriptionEditorRendering.svelte.spec.ts
pnpm vitest run --project client src/lib/components/transcriptionEditor/transcriptionEditorLayout.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Note: layout measurement requires injecting `app.css?inline` in `beforeAll` — the `client` project does not load Tailwind automatically, and numbers taken without it are meaningless. `transcriptionEditorLayout.svelte.spec.ts` already does this; copy the pattern.

Success: four tagged assertions inverted and passing; baseline green.

## Blocked by

None - can start immediately.
