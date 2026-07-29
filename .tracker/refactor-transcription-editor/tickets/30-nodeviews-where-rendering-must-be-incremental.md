# Ticket 30: NodeViews where rendering must be incremental

## Parent

`../SPEC.md` § E and § "Provisional Work Breakdown".

## What to build

There is not a single `addNodeView` in the codebase. Every node renders through `renderHTML`, which by design has no incremental update path — any attribute change rebuilds the whole subtree.

Add NodeViews with real `update(node)` methods **only where rendering must be incremental**, and nowhere else.

## Where to start

**Step one is a list, not a NodeView.** Enumerate which atom nodes actually change attributes during editing — the carrier atoms whose badges are edited through the inspector are the candidates. A `teiMilestone` written once and never edited does not need one, and adding NodeViews uniformly would trade one uniform mistake for another. Put the list in `TRACKER.md` before writing code, with a line each on why the node is in or out.

Read `../SPEC.md` § E and the § D discussion first: this ticket is downstream of tickets 14 and 22, and how much of it is still worth doing depends on what those left behind.

Sites: `app/src/lib/client/transcriptionEditorSchema.ts` — the inline atom nodes and marks, roughly 60% of the file, and the region ticket 01's coverage statement lists as least-read.

## Contract

- `renderHTML` **stays** as the serialization path. `parseHTML`, clipboard and `renderCorrectionContent`'s `generateHTML` all need it.
- A test asserts that each NodeView and its `renderHTML` agree — same attributes, same visible result. Two rendering paths that can disagree are worse than one slow path.
- NodeViews are added only to nodes on the written list, with the reason recorded.
- An attribute change on a node with a NodeView updates in place: no subtree teardown, asserted by DOM element identity across the change.
- No NodeView writes the selection. `../SPEC.md` § A applies here as everywhere.
- `update(node)` returns `false` for a node type or shape it cannot handle, letting ProseMirror rebuild — rather than silently rendering the wrong thing.

## Out of scope

- NodeViews for structural nodes (`Page`, `Column`, `Line`). Their chrome is handled by CSS in ticket 29, which needs no NodeView, and adding one would reintroduce imperative DOM where CSS suffices.
- Moving content out of attributes — ticket 22.
- `renderHTML` correctness — ticket 14.
- Performance work on the keystroke path — ticket 04.

## Acceptance criteria

- [ ] `TRACKER.md` carries the list of nodes considered, with in/out and a reason for each.
- [ ] Every node that changes attributes during ordinary editing is either on the list with a NodeView, or has a recorded reason why not.
- [ ] Changing an attribute on a NodeView'd node preserves DOM element identity, asserted by holding a reference across the change.
- [ ] Each NodeView's output and its `renderHTML` output agree, asserted per node.
- [ ] `parseHTML(renderHTML(node))` still round-trips for every affected node.
- [ ] Clipboard copy of a NodeView'd node produces the `renderHTML` form.
- [ ] Correction previews via `generateHTML` are unchanged.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/client/transcriptionEditorRendering.svelte.spec.ts
pnpm vitest run --project client src/lib/components/transcriptionEditor
pnpm run check
pnpm run test:unit -- --run
```

Success: the list exists and is justified; NodeViews update in place; the two rendering paths agree.

## Blocked by

- Ticket 14 (`14-renderhtml-becomes-pure-and-inline-valid.md`) — `renderHTML` must be pure before a second rendering path is layered over it, or the two cannot be compared.
- Ticket 22 (`22-formwork-content-lives-in-the-document.md`) — it changes which nodes are atoms with edited attributes, which is exactly the list this ticket starts from.
