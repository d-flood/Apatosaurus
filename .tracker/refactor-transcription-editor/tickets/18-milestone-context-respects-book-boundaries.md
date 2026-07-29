# Ticket 18: Milestone context respects book boundaries

## Parent

`../INVENTORY.md` F44.

## What to build

Verse insertion asks for the latest preceding **chapter** milestone and never checks whether a newer **book** milestone superseded it. The inserted TEI context and the status bar then disagree about where the caret is.

Executed: with `Book Mark`, `Chapter Mark 1`, then `Book Luke`, inserting verse 1 returned `ok` and produced:

```json
{ "book": "Mark", "chapter": "1", "verse": "1" }
```

while `getCurrentMilestoneValues` at the same position reported book `Luke`, chapter `1`.

## Where to start

`app/src/lib/components/transcriptionEditor/editorCommands.ts:372`, and `findPrecedingMilestoneNode` at `:352`.

The three milestone lookups are three separate front-to-back `nodesBetween(0, from)` walks — one each for `book`, `chapter` and `verse` — with no notion that a `book` invalidates any `chapter` that preceded it. `findPrecedingMilestoneNode`'s `if (!foundNode || pos > foundNode.pos)` guard is also dead weight, since `nodesBetween` already visits in document order.

The scriptural containment hierarchy is book › chapter › verse. A milestone at a broader level invalidates every narrower milestone before it.

## Contract

- Milestone resolution is **one backwards walk**, not three forward ones.
- A `book` milestone invalidates any `chapter` and `verse` that precede it. A `chapter` invalidates any preceding `verse`.
- Inserting a verse after `Book Mark` / `Chapter Mark 1` / `Book Luke` either reports that there is no chapter for the current book, or reports chapter under Luke — not Mark's chapter. **Which of those is right is a domain question**: decide whether an unchaptered book should refuse a verse insert or accept it with no chapter, and record the answer in `TRACKER.md`.
- `getCurrentMilestoneValues` and the verse-insert path use the **same** resolution function. The defect is that two code paths answer the same question differently; one function makes that impossible.
- The status bar shows what the insert would produce.

## Out of scope

- `getCurrentCursorPosition`'s page and column scans. **Ticket 04 rewrites that function** to derive page and column from `$from` ancestors, and it explicitly covers the three milestone scans as "one walk could serve all three". Coordinate: this ticket owns the *correctness* of milestone resolution, ticket 04 owns its *cost*. Whichever lands second must not undo the other. If 04 has already landed, extend its single walk rather than adding a second.
- The milestone insertion UI.
- `insertMetamarkForSelection` and the two-representations question (F17) — deliberately not in this epic.

## Acceptance criteria

- [ ] With `Book Mark` / `Chapter Mark 1` / `Book Luke`, inserting a verse produces the decided-on result, and `getCurrentMilestoneValues` agrees with it exactly.
- [ ] The ordinary case — `Book` / `Chapter` / verse with no intervening book — is unchanged.
- [ ] A chapter following a book correctly belongs to that book.
- [ ] Verse insertion and status display call one shared resolution function.
- [ ] `TRACKER.md` records the unchaptered-book decision.
- [ ] Baseline passes.

```bash
cd app
pnpm vitest run --project client src/lib/components/transcriptionEditor/editorCommands.svelte.spec.ts
pnpm run check
pnpm run test:unit -- --run
```

Success: the superseded-chapter case is asserted and passes; both call sites agree; baseline green.

## Blocked by

None - can start immediately. Coordinate with ticket 04 as described above.
