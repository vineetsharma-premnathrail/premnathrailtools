# R&D Tools — Extension Plan

## Current state

Already built: braking, hydraulic, load-distribution, qmax, spline, tractive-effort, and vehicle-performance calculators, plus calculation history (`backend/app/modules/rnd/`). This is a mature module — the extension below adds cross-department integration, not new calculators.

## Phase 1 — Calculation Requests

- New `rnd_calculation_requests`: a department (Design, Fluids, Electrical) can request a specific calculation against a `project_id`, with a requested-by, assigned R&D engineer, status (`requested → in_progress → completed`), and a link to the resulting `CalculationHistory` row once done.
- Turns R&D from a standalone tool into a serviced request queue — `notify_user` on completion, same pattern as every other module's status-change notifications.

## Phase 2 — Calculation Outputs as Engineering Documents

- Once [[design]]'s `engineering_documents` table exists, a completed R&D calculation's PDF report becomes attachable there (`discipline` could gain an `"rnd"` value, or the calculation simply gets a `engineering_document_id` back-reference) — gives R&D outputs a permanent, versioned home instead of living only in `CalculationHistory`.

## Phase 3 — Report Template Consistency Audit

- The seven calculators each have their own `reports/pdf_builder.py` — worth an audit pass to confirm they all follow one consistent house style (letterhead, header/footer, typography) rather than having quietly diverged over time. Not a data-model change, a design-QA pass.

## Interconnections

| With | Relationship |
|---|---|
| [[design]] | Calculation requests originate from Design (and Fluids/Electrical); outputs can land in Design's shared document repository |
| [[fluids]], [[electrical]] | Can request calculations the same way Design does — `rnd_calculation_requests.requested_by_department` as a free-text field, not a hardcoded enum, so any department can use it |

## Cross-cutting

- No `AVAILABLE_APPS` change needed — `rnd` already exists.
- `rnd_calculation_requests` references `project_id` and requesting/assigned user ids only — no reverse dependency on Design's document table existing before Phase 1 can ship.
