# 05 — Hierarchical picker with preview

## What to build

Replace ticket 04's flat unit list with a picker a scholar can actually work in: drill down through the reference edition's structural levels, see the text of the selected range before inserting it, and find the picker where they left it last time.

The flat list is fine for a 400-unit book and unusable for a whole-New-Testament edition of ~8,000 units. This is the ticket that makes seeding a tool rather than a demo.

Demo: open the picker on a multi-book edition, drill from book to chapter to verse, select a range, read its text in the preview, insert. Reopen the picker — it is where you left it.

## Where to start

- The picker that ticket 04 added, and the catalog accessor behind it.
- `listUnits` from ticket 04 is the only source of structure. The levels come from the units' milestone labels; nothing else knows the shape.
- Prior art for a filterable selection panel over a generated catalog: `app/src/lib/components/IgntpImportPanel.svelte` — read it for the interaction shape only. Do not modify it and do not import from it.
- Per-transcription UI state precedent: look at how existing editor state is persisted per document rather than globally.

## Contract

**Render only the levels the source actually has.** This is the contract most likely to be hard-coded wrong. The transcription model has three levels (book, chapter, verse), but a reference edition may populate one, two, or three of them:

- All three present → three-level drill-down.
- Book and verse but no chapter → two levels.
- Only unit references, no enclosing divisions → a single flat level, exactly as ticket 04 shipped.

The picker reads structure from the parsed edition. It never assumes three levels, and it never renders an empty control for a level the edition lacks.

**Still no label parsing.** Levels come from which milestone kinds the units carry, not from splitting label strings. The values remain opaque.

**Preview shows the text of the selected range** before insertion. Without it a scholar inserts blind, and the recovery story for "I put 400 verses in the wrong line" is worse than a preview pane.

**Position is remembered per transcription**, not globally. A scholar seeding folio by folio reopens this dozens of times; returning to the first verse of the edition every time makes the feature feel hostile by the tenth use. Two scholars' transcriptions, or one scholar's two transcriptions, do not share a position.

**Selection remains positional** — the handle is the unit's position in the list, and a repeated milestone reference still selects the occurrence the scholar clicked.

## Out of scope

- Changing `listUnits`, `extractRange`, insertion behavior, or the mark. All settled in 04 and 02.
- Multi-range selection. One insertion inserts one contiguous run; non-contiguous needs are met by inserting more than once.
- Full-text search across an edition's *content*. Filtering is over unit labels.
- User-supplied editions. Ticket 06.
- Modifying `IgntpImportPanel.svelte`.

## Acceptance criteria

- [ ] Browser spec: a fixture edition with book, chapter, and verse milestones renders three levels of drill-down.
- [ ] Browser spec: a fixture edition with only unit references renders one flat level and no empty controls.
- [ ] Browser spec: a fixture edition missing an intermediate level renders two levels.
- [ ] Browser spec: the preview shows text from the selected range and updates when the range changes.
- [ ] Browser spec: closing and reopening the picker in the same transcription restores the previous position; opening it in a different transcription does not.
- [ ] Browser spec: seeding still produces the same inserted content as ticket 04 — the picker changed, the insertion did not.
- [ ] Any new phosphor icon is added to `optimizeDeps.include` in `app/vite.config.ts`.

Commands:

```sh
cd app && pnpm run check && pnpm run test:unit -- --run && pnpm run test:e2e
```

Success = all exit 0.

## Blocked by

- 04 — the catalog, `listUnits`, `extractRange`, and the picker this slice replaces.
