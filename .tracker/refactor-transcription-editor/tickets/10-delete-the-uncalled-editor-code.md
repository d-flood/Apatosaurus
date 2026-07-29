# Ticket 10: Delete the uncalled editor code

## Parent

`../INVENTORY.md` F28, F29, F30, F34, F33.

## What to build

Five removals that cannot change behaviour, because the code is unreachable, uncalled, or a no-op. Landing this early shrinks the surface before the harder tickets, and a green suite afterwards is a cheap check that ticket 06's test net is actually wired up.

Roughly 90 lines out, plus one hygiene fix.

## Where to start

- **F28** `forcePageRender` — `TranscriptionEditor.svelte:1161`, sole caller at `:1314`. `contentVisibility` / `content-visibility` / `containIntrinsicSize` appear nowhere else in the app; the function saves `''`, writes `visible`, restores `''` — a no-op plus two forced style recalculations. Leftover from the reverted virtualization. 13 lines plus the call site.
- **F29** `restoreSelection` and `findLineStartPosition` — `InlineCarrierWorkspace.svelte:260–295`. Defined, never called. `findLineStartPosition` is a near-duplicate of `findLineStartPositionInDoc` (`:340`), which *is* used — keep that one. 36 lines.
- **F30** three unused exports in `tei-inspector-utils.ts`: `parseJsonObject` (`:1`), `prettyJson` (`:16`), `humanizeAttrKey` (`:208`) with its `ATTR_KEY_LABELS` table (`:175`). Each appears exactly once in the codebase — its own definition. ~40 lines.
- **F34** `insertBreakNode` — `editorCommands.ts:338`. No callers, and it could not work if it had any: `pageBreak`, `lineBreak` and `columnBreak` are absent from `MAIN_LINE_CONTENT_NODES`, so `line` does not admit them; `insertContent` drops the node and the function returns `true` anyway. Its `DEFECT F34` assertion in `editorCommands.svelte.spec.ts:282` goes with it.
- **F33** two extensions both named `doc` — `InlineCarrierDocument` (`transcriptionEditorSchema.ts:2284`) and `MarginaliaDocument` (`:2290`) are separate `Node.create({ name: 'doc', topNode: true })` definitions with the same name. They are never used together so nothing breaks today. Also `getProfileExtensions` (`:2493`) has no `else` and returns `undefined` for an unrecognised profile, which fails deep inside TipTap's constructor rather than at the call site.

While narrowing exports, four more are over-exported but internally used, so narrow rather than delete: `extractTextChildrenFromNodes`, `formworkContent.isStructuredFormWorkContent`, `pageFormwork.getPageChromeAttrs`, `editorInteractions.getSelectionRange`.

## Contract

- No behaviour changes. This ticket adds no test asserting new behaviour; the existing suite passing unchanged **is** the assertion.
- `findLineStartPositionInDoc` survives; only the unused near-duplicate goes.
- `getProfileExtensions` throws with a message naming the unrecognised profile rather than returning `undefined`.
- The two `doc` extensions get distinct names, and every reference is updated. If they cannot be renamed without touching serialized documents, stop and say so in `TRACKER.md` — do not rename a node type that appears in stored content.

## Out of scope

- **F31, the six `handleDOMEvents` suppressions.** They look like dead code and are not: nothing depends on them, but nobody knows what they were compensating for. Ticket 11 owns that question deliberately. Do not remove them here.
- **F9 `EmptyLineTextInputStabilizer`** — same reason, same ticket.
- Any refactor of the code left behind after a deletion.

## Acceptance criteria

- [ ] `forcePageRender`, `restoreSelection`, `InlineCarrierWorkspace`'s `findLineStartPosition`, `parseJsonObject`, `prettyJson`, `humanizeAttrKey`, `ATTR_KEY_LABELS` and `insertBreakNode` do not appear anywhere in `app/src` except, where relevant, a changelog note.
- [ ] The `DEFECT F34` assertion is removed along with the function it covered.
- [ ] `getProfileExtensions` throws on an unknown profile, with a test.
- [ ] The two `doc` extensions have distinct names, or `TRACKER.md` records why they could not.
- [ ] Four over-exported symbols are no longer exported.
- [ ] Net line change across the ticket is negative by at least 80 lines.
- [ ] Baseline passes with no test modified except the F34 removal.

```bash
cd app
grep -rn "forcePageRender\|insertBreakNode\|parseJsonObject\|prettyJson\|humanizeAttrKey\|ATTR_KEY_LABELS" src || echo "clean"
pnpm run check
pnpm run test:unit -- --run
git diff --stat
```

Success: the grep prints `clean`; `check` reports 0 errors; the unit suite is green; `git diff --stat` shows a net reduction.

## Blocked by

None - can start immediately.
