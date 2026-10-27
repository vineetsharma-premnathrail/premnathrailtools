# Spec + contract — Part B (Order Project removed, lifecycle stage, service gate)

Every builder codes against THIS contract in parallel. Do not invent other names.

## Decisions (Manager, logged)
- D1 Full removal of the Order Project entity: table `sales_order_projects` is dropped; its rows become PM projects
  (`pm_projects`). Elements (one per vehicle, one per non-RRV lot) stay, renamed "Units", moved to table
  `pm_project_elements` under the PM project.
- D2 Low-churn field names: consumer tables keep their columns `order_project_id` and `order_project_element_id`
  (and API/JSON keys of the same name) but they now point to `pm_projects.id` and `pm_project_elements.id`.
  Nothing user-visible says "Order project" any more — label it "Project" / "Unit" (vehicle / lot).
- D3 Lifecycle stage is a new field, shown where status was. The existing PM workflow `status`
  (planning/active/on_hold/technically_complete/closed/cancelled) stays for hold / cancel / close and release,
  shown as an extra pill only when on_hold or cancelled.
- D4 Machines (`erp_projects`) get their own `lifecycle_stage` too: a machine linked to a PM project mirrors the project
  stage whenever it changes; a machine with no project (Past Projects) is set by hand. Service availability reads the
  machine's stage. Migration default for existing unlinked machines = `closed` (Delivered) so Service keeps working
  today; the owner re-sets the ones still being built.
- D5 Auto "Dispatched": when every live unit of a project is dispatched (unit status dispatched/delivered),
  the project stage moves to `dispatched` if it was earlier. Never moves backwards automatically.

## Lifecycle stages (exact keys, order matters)
`LIFECYCLE_STAGES = ("planned", "design", "manufacturing", "assembly", "testing", "ready_for_dispatch", "dispatched", "commissioning", "handover", "closed")`
Labels: Planned, Design, Manufacturing, Assembly, Testing, Ready for Dispatch, Dispatched, Commissioning, Handover, Closed / Delivered.
`SERVICEABLE_STAGES = ("dispatched", "commissioning", "handover", "closed")`
Defined once in `backend/app/modules/projects/lifecycle.py` (owner: PM-lifecycle backend agent) with
`STAGE_LABELS`, `stage_index(key)`, `is_serviceable(key)`.

## Data model (owner: database-agent; ONE migration, down_revision = e3a9c1f7b2d4)
- `pm_projects` + `sales_order_id` int FK sales_orders.id unique nullable; `customer_id` int FK crm_organizations.id nullable;
  `branch_id` int FK branches.id nullable; `lifecycle_stage` String(30) not null server_default 'planned'.
- `erp_projects` + `lifecycle_stage` String(30) not null server_default 'planned'; data: rows with pm_project_id NULL -> 'closed';
  linked rows -> their project's stage.
- New model `app/modules/projects/models/element.py`: `PmProjectElement`, table `pm_project_elements` = old
  `sales_order_project_elements` renamed, column `order_project_id` renamed `project_id` (FK pm_projects.id CASCADE),
  unique (project_id, element_no) `uq_pm_project_element_no`. Same other columns. Constants moved there:
  `PM_ELEMENT_KINDS=("vehicle","lot")`, `PM_ELEMENT_STATUSES=("planned","in_progress","ready","dispatched","delivered","cancelled")`,
  `PM_ELEMENT_LOT_LINE_TYPES=("spares","other")`. `PmProject.elements` relationship (order_by id, cascade all, delete-orphan).
- Data move: each `sales_order_projects` row -> a `pm_projects` row: project_code=op_number, name=title,
  client_name=customer_name or 'Customer', customer_id, sales_order_id, branch_id, project_manager_id (or created_by_id),
  start_date=planned_start or created_at date, target_handover_date=planned_end or start_date,
  customer_po_ref/sales_order_ref from the sales order (customer_po_number / so_number, fallback '-'),
  status map active->active, on_hold->on_hold, delivered->technically_complete, closed->closed, cancelled->cancelled,
  lifecycle_stage: all live elements delivered -> 'closed'; any dispatched/delivered -> 'dispatched'; else 'planned'.
  If a pm_projects row with the same project_code already exists, reuse it (set sales_order_id etc. when empty).
  Keep a temp mapping op.id -> pm.id; repoint `pm_project_elements.project_id` and every consumer `order_project_id`.
- Consumer FKs: every `order_project_id` FK -> `pm_projects.id` ondelete SET NULL; every `order_project_element_id`
  FK -> `pm_project_elements.id` ondelete SET NULL. Tables: design_boms, design_requests, electrical jobs, hydraulic systems,
  p2p_goods_receipt_items, p2p_requests, p2p_request_items, p2p_purchase_order_items (check purchase_order.py),
  production MRP table (models/mrp.py), production_rrv_builds, production_work_orders, quality_inspection_calls,
  quality_inspection_lots, store_material_issues (+ its item table), store_stock_reservations.
  SQLite tests use create_all, so the model FKs must be right too.
- Drop `sales_order_projects`. Delete `app/modules/sales/models/order_project.py` ONLY at the end — Manager does it after integration;
  the database-agent leaves it in place but removes its mapping from env.py imports list (return snippet).
- Permission data: tab `sales:order_projects` / `projects:order_projects` grants -> drop (Manager handles registry).

## Core API (owner: core backend agent) — `backend/app/modules/projects/so_projects.py`
Replaces `app/modules/sales/order_projects.py` (same behaviour, now on PmProject + PmProjectElement). Consumers do
`from app.modules.projects import so_projects as op_core`. Public names (keep signatures of the old module):
`register_project_hook, register_element_status_hook, register_department_provider, needs_project(so),
ensure_project_for_order(db, so, actor) -> PmProject|None, sync_elements(db, project, so),
refresh_element_status(...), refresh_project_status(project, so=None), refresh_order_project(db, so, *, project=None)`
(name kept), `department_cells(...)`, `project_for_order(db, so_id)`, `elements_for_order(db, so_id, *, include_cancelled=False)`,
`element_for_schedule(db, schedule_id)`, `resolve_project(db, project_id, *, allow_closed=False) -> PmProject`,
`resolve_element(db, element_id, *, project_id=None, allow_cancelled=False) -> (PmProject, PmProjectElement)`,
`element_display(project, element)`, `project_label(project) -> "PEW-80 — <name>"`, `backfill(db, actor)`,
`PICKABLE_PROJECT_STATUSES = ("planning","active","on_hold","technically_complete")` (live PM statuses),
`PROJECT_STATUS_LABEL` (PM labels). Error texts say "project" / "unit", point to "Project Management › All Projects".
Attribute map for consumers: op_number->project_code, title->name, customer_name->client_name,
planned_start->start_date, planned_end->target_handover_date, element.order_project_id->element.project_id.
A project created from a sales order: status 'active' (released, so departments see it), lifecycle_stage 'planned',
project_manager_id = SO's assigned owner or the confirming user, PEW number from core/pew_numbers.next_pew_number.

## HTTP contract (backend owners as noted; frontend codes against this)
- REMOVED: `/sales/order-projects*` (all).
- `GET /projects/units/lookup?q=&kind=&include_projects=&project_id=` -> list of
  `{project_id, project_code, element_id, element_no, label, kind, client_name, so_number, display}` (same semantics as old lookup). [core agent, file `projects/routes/units.py`]
- `GET /projects/{id}/units` -> `{sales_order_id, so_number, so_status, customer_po_number, customer_po_date, order_value, currency,
   vehicles_total, vehicles_delivered, lots_total, elements: [ProjectUnitResponse]}`; ProjectUnitResponse = old OrderProjectElementResponse fields
   (incl. `departments` 360 cells). Data scope = the PM project's. [core agent]
- `PmProjectResponse` + `sales_order_id, so_number, lifecycle_stage, lifecycle_stage_label, units_total` [PM-lifecycle agent].
- `POST /projects/{id}/stage {stage, reason?}` -> PmProjectResponse. Forward any number of steps by project manager / management;
  backwards only admin or Partner with reason (422 without). Audit line, mirrors to linked machines. [PM-lifecycle agent]
- `GET /projects/meta` + `lifecycle_stages: [{key,label}]`.
- `PATCH /erp/projects/{id}/lifecycle-stage {stage}` for a machine WITHOUT a PM project (Past Projects); 409 for a linked one
  ("set it on project PEW-xx"). Permission: projects service_projects edit. [PM-lifecycle agent]
- Machine responses (erp ProjectResponse) + `lifecycle_stage`, `lifecycle_stage_label`, `serviceable` bool. Service request
  create/edit refuses a machine that is not serviceable (422 real message); machine pickers/lookups used by Service
  (service requests, service contracts, AMC, field visits) list only serviceable machines. [PM-lifecycle agent]

## Frontend (two agents)
- FE-1 (PM + Sales): remove `dashboard/projects/order-projects/**` and `dashboard/sales/order-projects/**` pages and their nav tabs;
  All Projects list shows lifecycle stage pill in the Status column (+ On hold / Cancelled pill); Overview gets a
  "Stage" control (Move to next stage / pick stage, admin back with PromptDialog reason); new "Units" tab on the project
  page (vehicles/lots + 360 department cells, SO link) when `sales_order_id`; Past Projects list + machine page show stage
  and let the owner set it (Select) for machines without a project; remove "+ New Service Request" from
  `dashboard/projects/service-projects/[id]` (and its empty-state hint text); Sales order detail links to the PM project
  (`recordPath('/dashboard/projects', ...)`). Owns `lib/api.ts` + `types/index.ts` for this change (small Edits), the
  `OrderProjectPicker` / `OrderProjectTable` components (rename to ProjectUnitPicker / ProjectUnitTable, update imports
  everywhere), projects + sales tour configs.
- FE-2 (consumers): design, p2p, production, quality, store, electrical, hydraulic pages: labels "Order project" -> "Project",
  "element" -> "Unit", links to `/dashboard/projects/<ref>` instead of order-projects pages, response field renames
  (op_number -> project_code etc. where the backend changed them).
