# Tracker for readings-and-stemma-phases

## Purpose

This document tracks the status of all tickets in the epic. Goal: make the CBGM data entry phases — Readings and local stemmata — completable, trustworthy, and worth completing. Today editorial decisions are recomputed from normalized-text equality on every write so they do not persist; the subreading attachment control silently no-ops for every case a scholar would reach for; the local stemma diagram overlays citation structure with genealogy in a fixed two-row layout and cannot be operated without a mouse; a lacuna is treated as a reading; nothing in either phase is undoable; and nothing anywhere consumes the result. Spec: `SPEC.md` in this directory.

The shape of the fix: separate the reading proposal from editorial decisions, reframe Readings around bulk witness selection, present the local stemma as an auto-laid-out single-source tree over arc-based storage, and end the flow in a Review phase with a reconstructive TEI apparatus validated against TEI P5. Geometry, the decision overlay, and apparatus rendering move into pure modules tested in the node project; the components become thin.

## Current Status

Overall status: `Not Started`

Current ticket: None

Last updated: 2026-07-29

## Ledger

Ticket 01 is a pure prefactor with no behaviour change — it makes everything after it a small change. Ticket 02 is the tracer bullet: it carries one decision kind end to end, proves the proposal/decision architecture, and fixes the headline bug on its own. Tickets 03, 04, and 05 then add decision kinds along the path 02 establishes and are **independent of each other** — they can run in parallel. Ticket 06 needs the completed reading model to render, and 07 consumes it. Ticket 08 deliberately delivers the accessible source-decision route before 09 adds pointer and keyboard graph gestures, so the stemma phase is fully operable even if 09 slips. Ticket 11 is the payoff and needs both the renderer and finished stemmata. Ticket 12 is research, gates nothing, and can run at any point.

The critical path is 01 → 02 → 05 → 08 → 10 → 11.

| Number | Filename | Status | Depends On |
| --- | --- | --- | --- |
| 01 | `01-extract-reading-proposal-module.md` | Not Started | None |
| 02 | `02-durable-subreading-attachment-and-undo.md` | Not Started | 01 |
| 03 | `03-non-attestation-out-of-reading-model.md` | Not Started | 02 |
| 04 | `04-reading-types-and-certainty.md` | Not Started | 02 |
| 05 | `05-lemma-establishment.md` | Not Started | 02 |
| 06 | `06-segment-and-apparatus-renderer.md` | Not Started | 03, 04, 05 |
| 07 | `07-readings-phase-cards-and-bulk-selection.md` | Not Started | 06 |
| 08 | `08-local-stemma-source-decisions-and-layout.md` | Not Started | 03, 05 |
| 09 | `09-stemma-graph-interaction.md` | Not Started | 08 |
| 10 | `10-lemma-root-coupling-and-connectivity.md` | Not Started | 08 |
| 11 | `11-review-phase-and-tei-apparatus-export.md` | Not Started | 06, 10 |
| 12 | `12-research-connectivity-absolute-value.md` | Not Started | None |
