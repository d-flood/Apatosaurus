# Ticket 20: Editor Selection Side Effects and Regression Harness

Architecture reference: `../architecture.md` sections 1 (audit findings), 6

## What to build

Close the remaining cursor-jump causes and prove the whole class fixed:

1. **Selection-affecting side features**: `scrollToVerse`, active-page tracking, and IIIF-driven navigation must not move the selection unless the user explicitly requested a jump. Audit the cursor-tracking debounce and `selectionUpdate` handlers for feedback loops (selection update -> state change -> effect -> selection change) and break them.
2. **Regression harness**: extend `/transcription/harness` with scripted scenarios — type at line end during autosave flush; type immediately after a structural element insert; correction workspace open/close; IIIF page change while typing — asserting selection stability (position delta only from typed characters).

## Where to start

- `app/src/lib/components/transcriptionEditor/editorInteractions.ts` — the 500ms cursor-position debounce + `selectionUpdate` handler pair is the suspected feedback loop; consider deriving cursor display state from a single subscription with no writes back to the editor.
- `app/src/routes/transcription/harness/` — the existing harness to extend with scripted scenarios.
- `app/src/lib/components/transcriptionEditor/CorrectionWorkspace.svelte` — workspace open/close scenario.
- Ticket 19's inventory (TRACKER.md Notes) lists the surviving mutation paths the harness must cover.

## Contract

- Scrolling and page tracking are read-only with respect to editor selection; explicit user jumps (clicking a verse) are the only selection writes.
- Harness scenarios are deterministic and assert selection position deltas exactly.
- Harness scenarios run in browser-mode vitest (or the harness route drives them) so they are repeatable in CI, not manual-only.

## Out of scope

- The `setContent`/repair conversions (ticket 19).
- New editor features; IIIF viewer (`triiiceratops`) internals.

## Acceptance criteria

- [ ] Audit of `editorInteractions.ts` cursor tracking recorded (TRACKER.md note): feedback loops found and how each was broken.
- [ ] All four harness scenarios implemented and passing.
- [ ] Scenario suite passes a 50-iteration loop with zero unexpected selection movement (scripted, e.g. vitest repeats or a harness loop mode).
- [ ] Full baseline passes.

```bash
cd app
bun run test:unit -- --run src/lib/components/transcriptionEditor
bun run check && bun run test:unit -- --run
```

Success: editor suites and the scenario loop pass; a manual editing session (typing across autosave boundaries, inserting corrections, switching pages) produces no cursor jumps.

## Blocked by

- 19 (`19-editor-init-only-setcontent.md`) — the harness asserts the post-19 mutation model.
