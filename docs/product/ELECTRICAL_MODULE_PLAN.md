# Electrical Department Module — Roadmap

## Current state

No `electrical` module exists yet — this is a new module, unlike `purchase`
which extended existing code. Two structural notes from the codebase that
shape the plan below:

- `AVAILABLE_APPS = {"erp", "rnd", "crm", "purchase"}` in `backend/app/modules/main/models/user.py` is the single source of truth for which modules a user can be granted. Adding "electrical" means updating this set, the `AppModule` type in `frontend/src/types/index.ts` (+ `useAuth.ts`), and the `APPS` checklist array in `frontend/src/app/dashboard/users/page.tsx`. No migration needed — `assigned_apps` is a JSON column.
- There's an already-scaffolded (but empty) `backend/app/modules/service/` directory (`api/`, `models/`, `schemas/`, `services/`, `tests/` — no files). Worth a quick check with whoever set that up before building `electrical` from scratch, in case it was intended for exactly this kind of department module.

Scope agreed: the module should cover all three of — electrical work/maintenance workflow, engineering documents (drawings/specs), and the electrical team's own internal task tracking.

## Phase 1 — Electrical Work Orders

- New `electrical_work_orders` table, modeled on `erp.ServiceRequest`'s shape but electrical-specific: `project_id` (FK to `erp_projects`, reused — a work order is against a machine/asset), equipment/panel tag, voltage system, fault/issue type, description, status (`open → assigned → in_progress → testing → resolved → closed`), priority.
- Optional `source_service_request_id` link so a work order can originate from an ERP Service Request (e.g. electrical fault reported during a service visit) without importing ERP route/service code — id-reference only, same boundary rule `purchase` already follows.
- Assignment to an electrical technician, expected/actual attend & completion dates — reuse the field shapes already proven in `ServiceRequest`.

## Phase 2 — Engineering Documents & Drawings

- New `electrical_documents` table: linked to `project_id` (and optionally `equipment_tag`), document type (single-line diagram, wiring diagram, panel layout, cable schedule, BOM, test certificate), version/revision number, superseded-by pointer for revision history.
- Reuse the existing attachment pattern exactly (`ProjectAttachment`/`ServiceRequestAttachment`): file lives in SharePoint via `app/utils/sharepoint.py` (`build_sharepoint_folder_path`, chunked upload for >4MB), only path/webUrl/filename/content_type/size persisted in Postgres. No new storage plumbing needed.
- Revision history view so engineers can see what changed between drawing versions without leaving the portal.

## Phase 3 — Internal Team Tracker

- Lightweight `electrical_tasks` table for work not tied to a Project — panel builds, bench testing, calibration, spares prep. Kanban shape: status (`todo/in_progress/blocked/done`), assignee, priority, due date.
- Team board UI (`/dashboard/electrical/tasks`) — simple drag-between-columns view, no need for the full work-order lifecycle here since it's internal-only.

## Phase 4 — Safety & Compliance Records

- Rail electrical work typically needs auditable safety records: `electrical_test_records` (insulation resistance, earthing/continuity test, LOTO log) tied to `project_id`/equipment tag, with test date, result, tested-by, next-due-date.
- Surface upcoming/overdue safety tests on the work order and dashboard views — ties naturally into `Project.warranty_end_date`/`amc_end_date` already on the ERP side.

## Phase 5 — Reporting & Dashboard

- Electrical dashboard: open work orders by priority/status, drawings pending revision, team workload (tasks per technician), safety tests due in next 30 days.
- Reuse `AuditLog` (new `entity_type="electrical_work_order"` etc.) and `notify_user`/`broadcast_notification` exactly as `purchase` does for approvals/status changes.

## Cross-cutting, every phase

- Register `electrical` in `AVAILABLE_APPS` (backend) and `AppModule` (frontend) before any UI work — everything else depends on `require_app_access("electrical")` existing.
- Keep the same module-boundary discipline as `purchase`: reference `erp_projects`/`erp_service_requests` by id only, never import ERP route/service code directly.
- One Alembic migration per phase, same convention as the `purchase` module's backups.
