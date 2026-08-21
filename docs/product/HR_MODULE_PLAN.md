# HR Department Module — Roadmap

## ⚠️ Confirm scope before building

`docs/product/PRODUCT.md` lists "HR module (exists in ADP)" as an explicit non-goal. This plan scopes HR as a **directory/org-chart extension** of the existing `User` record, not payroll, attendance, or leave management — those stay in ADP. Confirm this is still the company's position before building.

## Current state

`User` (`backend/app/modules/main/models/user.py`) already has `name`, `email`, `role`, `department`, `phone`, `designation` — a thin employee profile already exists, just not surfaced as an HR-owned view.

## Phase 1 — Employee Directory

- No new tables — a read view over the existing `User` table (`/dashboard/hr`), filterable by department/designation, org-chart style grouping.
- Add `reporting_manager_id` (nullable, self-referencing FK to `users.id`) and `date_of_joining` to `User` — the two fields genuinely missing for an org chart, via a small migration.
- `require_app_access("hr")` for the directory view; editing an employee's HR fields (manager, DOJ, designation) should probably require admin or a new `hr` role tier, not open to every HR-app user — decide during implementation based on who actually needs write access.

## Phase 2 — Org Chart Visualization

- Tree/chart rendering of `reporting_manager_id` chains — a visualization feature, no new data model beyond Phase 1's field.

## Phase 3 (only if scope changes) — Leave/Attendance

- Explicitly **not planned** under the current non-goal. If the company decides the portal should own this instead of ADP, treat it as a new, separately-scoped plan — leave/attendance/payroll is a different order of magnitude (approval workflows, accrual rules, payroll integration) from a directory extension.

## Interconnections

| With | Relationship |
|---|---|
| [[admin]] | Natural home for managing the HR profile fields once they exist — Admin already owns user management; HR either becomes a filtered view within Admin or a thin sibling module reading the same `User` table |
| Every department | The directory is a cross-cutting reference (who reports to whom, who's in which department) other modules may want to display, e.g. Project Management's task assignment — read-only reference by id, same as everywhere else |

## Cross-cutting

- Register `"hr"` in `AVAILABLE_APPS`.
- The `reporting_manager_id`/`date_of_joining` migration is additive to the existing `users` table — no data loss risk, straightforward `op.add_column`.
