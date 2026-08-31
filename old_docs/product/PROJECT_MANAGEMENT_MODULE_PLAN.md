# Project Management Department Module — Roadmap

## Current state

No `project_management` module exists. This is a broader scheduling/coordination layer over `erp_projects`, separate from the single-machine Project record that exists today (which tracks one machine/asset's lifecycle, not a multi-workstream program).

## Phase 1 — Milestones & Tasks

- New `project_milestones`/`project_tasks`: linked to `erp_projects`, Gantt-style view, dependencies (`depends_on_task_id`, self-referencing).
- Reuse CRM's `InquiryTask` shape (`department` as a free-text field for cross-department assignment) instead of inventing a second task model — CRM already proved this pattern works for pre-sales task assignment across departments; Project Management's tasks are the same shape applied post-sale.

## Phase 2 — Budget vs. Actual

- Pulls from [[purchase-department]]'s Phase 3 budget tracking and [[accounts]]'s cost roll-up once those exist, rather than tracking project cost a third time. This phase is blocked on those two, not standalone-buildable — sequence it after both.

## Phase 3 — Cross-Department Task Visibility

- A single board showing every open task across every department for a given project — reads `project_tasks` (Phase 1) plus, once they exist, [[production]]'s production orders, [[quality]]'s open inspections, [[service-commissioning]]'s commissioning checklist punch-list — a read rollup, not a new task system duplicating those.

## Interconnections

| With | Relationship |
|---|---|
| [[business-development]] (CRM) | Reuses `InquiryTask`'s task shape rather than inventing a parallel model |
| [[purchase-department]] | Budget vs. actual (Phase 2) depends on Purchase's Phase 3 costing |
| [[accounts]] | Budget vs. actual also depends on Accounts' cost roll-up |
| [[production]], [[quality]], [[service-commissioning]] | Cross-department task visibility (Phase 3) reads their entities read-only |

## Cross-cutting

- Register `"project_management"` in `AVAILABLE_APPS`.
- Phase 1 is standalone-buildable today; Phases 2-3 are explicitly sequenced after other departments' plans land — don't build placeholder/duplicate cost or task tracking here just to avoid the dependency.
