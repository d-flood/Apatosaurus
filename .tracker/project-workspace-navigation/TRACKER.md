# Tracker for project-workspace-navigation

## Purpose

This document tracks the status of all tickets in the epic. Goal: reorganize the app around the open project (ADR-0001) — a two-destination navbar with a project switcher, real project-scoped sub-routes replacing the mega Projects page's tabs, a calm picker, an app-wide Data & Storage page, and (Phase 2) a re-entry dashboard at `/`. Spec: `SPEC.md` in this directory.

Tickets are vertical slices; the mega-page decomposition is expand–contract (02 expands, 04 contracts). Phase 1 = tickets 01–07 (independently shippable); Phase 2 = ticket 08.

## Current Status

Overall status: `Not Started`

Current ticket: None

Last updated: 2026-07-18

## Ledger

| Number | Filename | Status | Depends On |
| --- | --- | --- | --- |
| 01 | `01-last-opened-resolution-module.md` | Completed | None |
| 02 | `02-project-workspace-routes.md` | Not Started | 01 |
| 03 | `03-clean-libraries.md` | Not Started | 02 |
| 04 | `04-picker-and-data-page.md` | Not Started | 02 |
| 05 | `05-navigation-cutover.md` | Not Started | 01, 02, 04 |
| 06 | `06-creation-project-selector.md` | Not Started | 01 |
| 07 | `07-backup-list-titles.md` | Not Started | None |
| 08 | `08-dashboard.md` | Not Started | 04, 05 |
