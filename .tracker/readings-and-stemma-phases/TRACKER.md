# Tracker for readings-and-stemma-phases

## Purpose

This document tracks the status of all tickets in the epic. Goal: make the CBGM data entry phases — Readings and local stemmata — completable, trustworthy, and worth completing. Today editorial decisions are recomputed from normalized-text equality on every write so they do not persist; the subreading attachment control silently no-ops for every case a scholar would reach for; the local stemma diagram overlays citation structure with genealogy in a fixed two-row layout and cannot be operated without a mouse; a lacuna is treated as a reading; nothing in either phase is undoable; and nothing anywhere consumes the result. Spec: `SPEC.md` in this directory.

The shape of the fix: separate the reading proposal from editorial decisions, reframe Readings around bulk witness selection, present the local stemma as an auto-laid-out single-source tree over arc-based storage, and end the flow in a Review phase with a reconstructive TEI apparatus validated against TEI P5. Geometry, the decision overlay, and apparatus rendering move into pure modules tested in the node project; the components become thin.

## Current Status

Overall status: `In Progress`

Current ticket: None

Last updated: 2026-08-13

## Ledger

Ticket 01 is a pure prefactor with no behaviour change — it makes everything after it a small change. Ticket 02 is the tracer bullet: it carries one decision kind end to end, proves the proposal/decision architecture, and fixes the headline bug on its own. Tickets 03, 04, and 05 then add decision kinds along the path 02 establishes and are **independent of each other** — they can run in parallel. Ticket 06 needs the completed reading model to render, and 07 consumes it. Ticket 08 deliberately delivers the accessible source-decision route before 09 adds pointer and keyboard graph gestures, so the stemma phase is fully operable even if 09 slips. Ticket 11 is the payoff and needs both the renderer and finished stemmata. Ticket 12 is research, gates nothing, and can run at any point.

The critical path is 01 → 02 → 05 → 08 → 10 → 11.

| Number | Filename | Status | Depends On |
| --- | --- | --- | --- |
| 01 | `01-extract-reading-proposal-module.md` | Completed | None |
| 02 | `02-durable-subreading-attachment-and-undo.md` | Completed | 01 |
| 03 | `03-non-attestation-out-of-reading-model.md` | Completed | 02 |
| 04 | `04-reading-types-and-certainty.md` | Not Started | 02 |
| 05 | `05-lemma-establishment.md` | Completed | 02 |
| 06 | `06-segment-and-apparatus-renderer.md` | Not Started | 03, 04, 05 |
| 07 | `07-readings-phase-cards-and-bulk-selection.md` | Not Started | 06 |
| 08 | `08-local-stemma-source-decisions-and-layout.md` | Not Started | 03, 05 |
| 09 | `09-stemma-graph-interaction.md` | Not Started | 08 |
| 10 | `10-lemma-root-coupling-and-connectivity.md` | Not Started | 08 |
| 11 | `11-review-phase-and-tei-apparatus-export.md` | Not Started | 06, 10 |
| 12 | `12-research-connectivity-absolute-value.md` | Not Started | None |

## Notes

| Date | Note |
| --- | --- |
| 2026-08-13 | Ticket `03` completed after a remediation pass. The first attempt shipped green but inert: `classifyWitnessAttestation` decided attestation from text presence (`!cells.some(cell => cell.text?.trim())`, inherited verbatim from the old `isLacuna` bucket predicate), while every real gap cell carries text — the tokenizer emits `⊘` for gap and untranscribed milestones and a supplied-only token collated as a gap keeps the editor's restored letters. A genuine `<gap>` witness therefore still took a letter, still counted in ordering, and would still have become a stemma node; the lacuna buckets it derived from had never formed either. The specs passed only because their fixtures built cells with `text: ''`, a shape `toCellText` never returns. Attestation is now decided from the fields that carry the information — `cell.kind` and the damage flag — so gap, untranscribed, and supplied-as-gap cells are absent testimony whatever text they carry, and a slot emptied by `shiftToken` or `mergeCells` while still flagged damaged is absence rather than an omission the witness attests. `collation-projection.ts` no longer borrows another reading's text for `base_text` when the base witness does not testify. Non-attestation is otherwise as specified: `buildReadingProposal` returns `{ readings, nonAttestation: { witnessIds, untranscribedWitnessIds } }`, non-attesting witnesses never reach `buildReadingFamilyGroups`, lettering and ordering are identical whether a witness is lacunose or simply absent, `setReadingParent` refuses non-attestation in both directions because it holds no reading id, `alignment-snapshot.ts` recovers `untranscribed` from `gap.source` for cells stored without a kind, and the readings phase pins one non-attestation row last with damaged and not-yet-transcribed sigla listed separately. The lacuna fixtures are now built by running the real adapter over a gap token, and a store-level spec drives a real `<gap>` witness through collation and asserts it takes no letter and lands in `nonAttestation.witnessIds`; every corrected spec was confirmed red against the pre-remediation classifier. Server suite (604 tests), client browser project (249 tests), and `pnpm check` pass; `pnpm lint` is unchanged from baseline (the `no-useless-assignment` error in `reference-editions/insertion.ts` and 21 unused-var warnings). |
| 2026-08-13 | Ticket `05` completed. The lemma is now an editorial decision: `UnitDecisions.lemmaReadingId` rides the ticket-02 overlay, `relabelReadings` takes the lemma so it labels `a` while the base-text reading keeps its place ahead of the rest, and a base text that is lacunose or excluded yields no lemma — the unit is reported as needing a decision instead of promoting the majority reading. Divergence and the needs-decision worklist are queryable from the store; elevation is one undoable command and never touches arcs; refused reorders now return a reason. Review caught that the derived readings' `order` field did not follow the lemma-first labelling, so `collation-projection.ts` and the TEI `<lem>` selection would have disagreed with the letters a scholar saw; `relabelReadings` now stamps the rank its own labelling implies, which also fixed reorder acting on a different row than the one displayed. `buildApparatus` was not passing the base witness, so a derived lemma was lost on save. Server and client vitest projects, `pnpm lint` (bar the known `no-useless-assignment` baseline error), and `pnpm check` pass. |
| 2026-08-12 | Tickets `01` and `02` completed. The reading proposal is now a pure module; sparse subreading editorial decisions are keyed by stable variation-unit identity, applied on read, persisted independently of derived readings, preserved as orphaned decisions, and covered by phase-aware undo. Focused decision/state/persistence tests and `pnpm check` pass. Full acceptance commands remain affected by unrelated baseline failures: `pnpm lint` reports `no-useless-assignment` in `reference-editions/insertion.ts`, and full browser collection intermittently fails unrelated editor/Data & Storage specs. |
| 2026-08-11 | Ticket `02` rewritten after an architecture review, and `SPEC.md` corrected. Two findings. First, an **editorial decision** had no durable address as well as no durable identity: decisions and stemma edges are keyed by `getReadingUnitKey`, which returns a position in `alignmentColumns`, while `mergeColumns`, `splitColumn`, and `shiftToken` all reindex that array and touch neither map. Splitting proposal from decision without fixing the key would have produced decisions that persist faithfully under the wrong **variation unit** — worse than ones that vanish. The identity is already computed and discarded: `collation-document.ts` builds `unit:${columnId}` on write and re-keys by `unitIndex` on read. Ticket 02 now carries the key change; the blast radius is one function and its six call sites, and `stemmaEdges` follows for free because the stemma functions call the same helper. Second, `SPEC.md` claimed re-running an alignment stops destroying editorial work. It cannot: `collation-adapter.ts` assigns every column a fresh `crypto.randomUUID()` per run, so nothing column-derived survives a re-collation and reattaching needs a content-derived anchor nobody has designed. The SPEC now scopes the claim to hand edits and states the re-collation gap explicitly, and ticket 02 forbids inventing an anchor. `CONTEXT.md` gained a **Variation unit** entry. |
