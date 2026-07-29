# Tracker for offline-capable-pwa

## Purpose

This document tracks the status of all tickets in the epic. Goal: make the app genuinely offline-capable by replacing the current all-or-nothing precache with a tiered cache warm — a tiny blocking shell tier that fixes offline boot (broken today: no HTML shell ever enters the cache, so an offline reload yields a plain-text 503), a throttled background warm of all route chunks driven from an idle callback in the page, and an opt-in tier for the 38 MB IGNTP reference corpus surfaced on the Data & Storage page. Spec: `SPEC.md` in this directory.

Every caching decision moves into a pure `offline-cache-policy` module tested in node vitest; the service worker becomes a thin adapter. One Playwright spec proves offline boot and unvisited-route navigation against the real built output.

## Current Status

Overall status: `Completed`

Current ticket: None

Last updated: 2026-07-29

## Ledger

Ticket 01 is the tracer bullet and the entire fix for the bug that exists today. Tickets 02–04 form the tiering chain; ticket 05 needs only 01 and can run in parallel with them.

| Number | Filename | Status | Depends On |
| --- | --- | --- | --- |
| 01 | `01-shell-tier-and-offline-boot.md` | Completed | None |
| 02 | `02-background-warm-routes-tier.md` | Completed | 01 |
| 03 | `03-offline-readiness-on-data-page.md` | Completed | 02 |
| 04 | `04-opt-in-reference-corpus-tier.md` | Completed | 03 |
| 05 | `05-non-destructive-updates.md` | Completed | 01 |
