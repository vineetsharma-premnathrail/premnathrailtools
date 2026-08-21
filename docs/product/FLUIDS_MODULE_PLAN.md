# Fluids (Hydraulic & Pneumatic) Department Module — Roadmap

## Current state

No `fluids` module exists. This mirrors [[electrical]]'s shape almost exactly — same three phases (work orders, engineering docs, safety/test records), different domain fields. Given the near-identical shape to Electrical, share tables with a `discipline` column rather than building parallel schemas — see the reconciliation note in [[design]].

## Phase 1 — Fluids Work Orders

- New `fluids_work_orders` (or, if the shared-table reconciliation with Electrical happens first, a `discipline="fluids"` row in a shared `engineering_work_orders` table): `project_id`, circuit/component tag, pressure rating, fluid type (hydraulic oil/compressed air), fault type, status (`open → assigned → in_progress → testing → resolved → closed`), priority.
- Optional `source_service_request_id` link, same id-reference-only pattern as Electrical's Phase 1.

## Phase 2 — Circuit Diagrams & Component Datasheets

- Lands in the same shared `engineering_documents` repository as [[design]] and [[electrical]], with `discipline="fluids"` — hydraulic/pneumatic circuit diagrams, component datasheets, BOM.

## Phase 3 — Test Records

- `fluids_test_records` (or shared `engineering_test_records` with `discipline="fluids"`): pressure test, leak test, cycle test — same shape as Electrical's insulation/earthing tests. Tied to `project_id`/component tag, test date, result, tested-by, next-due-date.

## Phase 4 — Internal Team Tracker

- Lightweight Kanban board for fluids work not tied to a Project (bench testing, seal replacement, calibration) — same shape as Electrical's Phase 3.

## Phase 5 — Reporting & Dashboard

- Open work orders by priority/status, tests due in next 30 days, team workload.

## Interconnections

| With | Relationship |
|---|---|
| [[electrical]] | Near-identical schema shape — strongly consider one shared `engineering_work_orders`/`engineering_test_records`/`engineering_documents` table set with a `discipline` column instead of three parallel schemas; whichever module is built first should design for this, not just for itself |
| [[design]] | Shares the engineering document repository |
| [[rnd]] | Can request hydraulic calculations (already one of R&D's existing calculators) against a fluids work order |
| [[quality]] | Pressure/leak test results may feed final inspection sign-off |

## Cross-cutting

- Register `"fluids"` in `AVAILABLE_APPS`.
- Before writing migrations, check whether [[electrical]] or [[design]] has already been built — if so, extend their shared tables with `discipline="fluids"` rather than creating new ones.
