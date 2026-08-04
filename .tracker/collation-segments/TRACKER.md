# Tracker for collation-segments

## Purpose

This document tracks the status of all tickets in the epic. Goal: let a scholar collate transcriptions that name the same verse differently — IGNTP's `Rom 1:1` and Robinson-Pierpont's `B06 B06K1:B06K1V1` — by declaring the identifiers equivalent and naming the passage themselves, so that a project holding both conventions stops silently collating a subset of its witnesses. Spec: `SPEC.md` in this directory. Vocabulary: `CONTEXT.md` at the repo root, Collation section.

The central design commitment is that **the app never interprets a milestone value**. There is no canonical versification, no book-name table, no conversion of the bundled Robinson-Pierpont asset, and no parser change. The equivalence is asserted by the scholar, who has the documents in front of them. Every rejected alternative failed the same way: it put domain knowledge the app cannot verify into code the scholar cannot inspect, and it broke on arbitrary reference schemes — which the shipped IGNTP Romans corpus already contains (`Rom.inscriptio`, `Rom.subscriptio`).

Tickets are vertical slices and the chain is linear: **01 → 02 → 03.** Ticket 01 delivers the whole path with a single member, so the type, the stored shape, and the naming guarantee land before the set grows. Ticket 02 is the slice that solves the stated problem. Ticket 03 is the failure path, split out deliberately — folded into 02 it is the part a tired implementer skips, and skipping it restores the exact silent-witness-loss this epic exists to remove.

## Known hazard

The most likely way this epic goes wrong is not a bug but a helpful addition: having built member-picking in ticket 02, suggesting that `B06K1V1` and `Rom.1.1` look equivalent is a small and obvious-seeming next step. It is fenced in the spec and in ticket 02's Out of scope, with the reason. Any suggestion, ranking, or similarity-ordering of candidate identifiers is out of scope for this epic and should be rejected in review, not negotiated.

## Known defect — not in this epic

`sortVerses` (`app/src/lib/client/collation/gather-verses.ts:68`) orders by `Number(a.verse) - Number(b.verse)`. The shipped IGNTP Romans corpus contains `Rom.inscriptio` and `Rom.subscriptio`, which produce `NaN` and therefore a comparator returning `NaN` — an unspecified sort order. This is live today and independent of this work. It is recorded here because the references it mishandles are exactly the arbitrary-reference case this epic supports, and a reader may otherwise assume the epic addressed it. It needs its own ticket.

## Current Status

Overall status: `Not Started`

Current ticket: None

Last updated: 2026-08-04

## Ledger

| Number | Filename | Status | Depends On |
| --- | --- | --- | --- |
| 01 | `01-collate-under-a-scholar-supplied-name.md` | Not Started | None |
| 02 | `02-group-several-identifiers.md` | Not Started | 01 |
| 03 | `03-report-orphaned-members.md` | Not Started | 02 |
