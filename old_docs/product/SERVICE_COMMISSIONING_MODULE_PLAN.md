# Service & Commissioning Department — Roadmap

## Current state

Mostly **already built** as `erp.ServiceRequest` (issue tracking, warranty, resolution, customer sign-off, billing) — it's filed under "erp" today rather than having its own identity. Two real gaps, not a from-scratch module.

## Phase 1 — Commissioning Checklists

- New `commissioning_checklists`: linked to `project_id`, pre-commissioning check items, test results, customer training sign-off, punch-list items (issue + resolved-by + resolved-date per line).
- Replaces `Project.commissioning_date` being just a date field with an actual auditable record of what was checked and signed off.
- Generated commissioning report — reuse the PDF/letterhead pattern already established by R&D's report generators.

## Phase 2 — Department Identity / Scoped View

- Decide whether Service & Commissioning gets its own `require_app_access("service")` scoping — a permissions/UI change filtering existing `ServiceRequest` data into a dedicated dashboard, rather than a data-model change. Low effort, mostly a routing/permission decision.

## Interconnections

| With | Relationship |
|---|---|
| [[quality]] | Commissioning's pre-commissioning checks may overlap with Quality's final inspection — decide who owns the checklist item once Quality is built, don't duplicate |
| [[maintenance]] | Distinct populations — Service & Commissioning is *client* machines (already `erp_projects`), Maintenance is Premnath's *own* equipment. Don't merge these, but the checklist/test-record shape can be reused |
| [[accounts]] | Reads `ServiceRequest.service_cost`/`total_bill`/`payment_status` for revenue rollup |

## Cross-cutting

- If Phase 2's scoped view is built, register `"service"` in `AVAILABLE_APPS`; if the team stays inside the existing `erp` app permission, no new key needed.
- `commissioning_checklists` references `project_id` only — no new module boundary concerns, it's an extension of data ERP already owns.
