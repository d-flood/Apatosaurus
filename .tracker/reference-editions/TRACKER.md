# Tracker for reference-editions

## Purpose

This document tracks the status of all tickets in the epic. Goal: let a scholar bootstrap a transcription from a **reference edition** — a published critical edition, bundled or user-supplied — instead of typing every character, while keeping seeded text visibly **unconfirmed** until a human has checked it against the manuscript. Also removes the one encumbered file this repository currently redistributes. Spec: `SPEC.md` in this directory. Vocabulary: `CONTEXT.md` at the repo root, Transcription section.

Tickets are vertical slices. Ticket 02 delivers the `unconfirmed` mark through the cheapest thing that can create it (paste), which is also the stop-gap scholars can use before seeding exists.

**Critical path: 02 → 04 → 06 → 08.** Ticket 02 gates almost everything, and it is the riskiest work in the epic — mark invalidation lands in the part of the editor that already required `selection-stability.svelte.spec.ts` and two remediation tickets under `.tracker/files-as-database/`. Tickets 01 and 02 can both start immediately; nothing else can start until 02 lands. Letting 04 ship seeding unmarked and retrofitting the mark was considered and rejected — it would leave already-seeded text permanently untrusted but unflagged.

Ticket 04 is the widest slice. If it will not fit a single context window, split it at the seam between the catalog-and-parse half and the insert-and-picker half rather than dropping contract items.

## Known hazard

`app/playwright.config.ts` still runs `bun run build && bunx vite preview`, despite `AGENTS.md` specifying pnpm and the `convert from bun to pnpm` commit. It works on machines where bun happens to be installed and will fail on a fresh checkout or in CI. Every ticket's acceptance criteria include `pnpm run test:e2e`, which shells into it. Deliberately **not** fixed as part of this epic — if it bites, that is what it is, not a fault in the ticket.

## Current Status

Overall status: `Not Started`

Current ticket: None

Last updated: 2026-07-22

## Ledger

| Number | Filename | Status | Depends On |
| --- | --- | --- | --- |
| 01 | `01-remove-encumbered-base-text.md` | Not Started | None |
| 02 | `02-paste-creates-unconfirmed-text.md` | Not Started | None |
| 03 | `03-review-reveal-and-warn.md` | Not Started | 02 |
| 04 | `04-seed-from-bundled-reference-edition.md` | Not Started | 02 |
| 05 | `05-hierarchical-picker-with-preview.md` | Not Started | 04 |
| 06 | `06-bring-your-own-reference-edition.md` | Not Started | 04 |
| 07 | `07-attribution-in-exported-tei.md` | Not Started | 04 |
| 08 | `08-whole-account-export-includes-editions.md` | Not Started | 06 |

## Prerequisite outside this epic

Ticket 04 requires a Robinson-Pierpont TEI edition file to bundle. The maintainer is sourcing it. It must be structured so that `listUnits` finds addressable units — divisions with references, in the shape the TEI parser already reads. Ticket 04 cannot complete without it, though its source-contract and insertion work can proceed against fixtures.

## Deferred

Raised during design, deliberately not in this epic:

- **Lectionary duplicate-verse collation.** `transcription_verse_index` enforces `UNIQUE(transcription_id, verse_identifier)`, and `extractWitnessTokensForVerse` concatenates every region in a document matching a verse. A manuscript containing a verse twice already collates as one merged reading — pre-existing, independent of reference editions, and needing its own investigation.
- **Collation guard on unconfirmed witnesses** — warning or refusing to collate witnesses with unconfirmed regions, once the mark exists.
- **A utility to "clean" an existing transcription into a reference edition.**
- **Explicit offline management of editions** with visible storage use and eviction, alongside the image-caching item in `ideas.md`.
- **Renaming the collation `isBaseText` flag to "base witness"**, which would free the better vocabulary for reference editions at the cost of a canonical collation-format migration.

## Candidate ADRs

Each is hard to reverse, surprising without context, and the result of a genuine trade-off. None written yet.

1. Unconfirmed text tracks *confirmation*, not *provenance* — why editing clears it, why explicit review exists, why range-level provenance was rejected.
2. User-supplied editions are app-scoped and excluded from project archives — the redistribution argument.
3. "Reference edition" rather than "base text" — why the better vocabulary was declined and what changing it would cost.
