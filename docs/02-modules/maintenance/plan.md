# Maintenance Module — Plan

**Module:** Maintenance
**Backend Location:** `backend/app/modules/maintenance/` (to be created)
**Frontend Location:** `frontend/src/app/dashboard/maintenance/` (empty scaffold folders already exist: `assets`, `requests`, `work-orders`, `schedule`, `spares`, `reports`)
**Prepared by:** Vineet Sharma
**Date:** 29 September 2026
**Status:** Draft. The open questions in §12 need answers before Phase 1 starts.

---

# 1. Purpose

The Maintenance module is the plant's maintenance management system (CMMS). It answers four questions the portal can't answer today:

1. **What equipment do we have, where is it, and what state is it in?** This is the asset register.
2. **What broke, how long was it down, and what fixed it?** This covers breakdown requests, work orders and downtime.
3. **What servicing is due, and did it happen on time?** This covers preventive maintenance (PM) plans.
4. **What did it cost, and which machines are the worst offenders?** This covers spares, labour, MTTR/MTBF and reports.

The core design decision is that **Maintenance owns no stock.** Spare parts are Store items (`item_type = "spare_part"`), and every spare used on a job is posted through the Store stock ledger (`post_stock_transaction`). Maintenance keeps only the link between a job and the spares it consumed. This follows the Store module's rule that the transaction log is the single source of truth (see [Store overview](../store/overview.md)).

---

# 2. What already exists, and how Maintenance relates to it

| Existing concept | Where | Relationship to Maintenance |
|---|---|---|
| `ProductionWorkstation` has a status of `active` / `under_maintenance` / `inactive` | `production/models/workstation.py:7` | A maintenance asset can **optionally link** to a workstation. When a job takes the machine down, Maintenance sets the workstation to `under_maintenance`. The existing `ensure_workstation_available()` check (`production/routes/work_orders.py`) then blocks shop-floor use automatically. When the job is closed, the workstation goes back to `active`. |
| Store items with `item_type = "spare_part"`, the stock ledger and reservations | `store/models/item.py:10`, `store/services/stock_ledger.py:44` | These are the spares catalog and stock. Maintenance reads and posts through them and never duplicates them. |
| `Branch` (shown as "Plant" in the UI) and `Department` | `organization/models/` | Every asset belongs to a plant, and optionally to a department. |
| HR `HrAsset` (laptops, SIMs, vehicles issued to employees) | `hr/models/asset.py` | **Out of scope for Maintenance.** Employee-issued assets stay in HR. Maintenance covers plant equipment. |
| ERP `ServiceRequest` (field service on *customer* machines) | `erp/models/service_request.py` | **Separate.** ERP handles customer-site service. Maintenance handles our own plant. They are not merged. |
| Accounts internal-order type `"maintenance"` | `accounts/models/internal_order.py:8` | Used for cost booking in Phase 3. |
| Calibration | nowhere | Nothing exists yet. Maintenance can own it (Phase 3), subject to open question Q2. |

**Dependency risk:** the Production module is currently untracked in git and is being edited in parallel. The workstation link (§4.1) and status sync (§5.4) depend on it. Build Phase 1 so the workstation link is nullable and the status sync is a no-op when no workstation is linked. That way Maintenance can ship even if Production slips.

---

# 3. Users and roles

The module is gated by one app key, `maintenance`. Roles are expressed through the existing granular permission registry (`core/permission_registry.py`) rather than new role tables.

| Role | Typical person | What they do |
|---|---|---|
| **Requester** | Production supervisor, shift in-charge, any department | Raises breakdown or maintenance requests and confirms the machine is OK after repair. This role does **not** need the `maintenance` app. The raise and confirm endpoints accept `require_any_app_access("maintenance", "production")`, following the P2P precedent of one router serving two audiences. |
| **Technician** | Maintenance fitter or electrician | Sees assigned work orders, starts and stops work, logs labour, requests spares, records the root cause and action taken. |
| **Maintenance Planner / Head** | Maintenance in-charge | Triages requests, creates and assigns work orders, owns PM plans, verifies and closes jobs, and sees reports. |
| **Plant Head / Management** | Plant head, management | Read-only dashboard and reports. |

Permission registry entry (`MODULES["maintenance"]`), with subtabs matching `MaintenanceNav.tsx` one-to-one:
`dashboard`, `assets`, `requests`, `work_orders`, `schedule`, `spares`, `reports`, used with the standard actions (`view`, `create`, `edit`, `delete`, `approve`, `export`, `print`, `import`). The Planner and Head role maps to `work_orders:approve`, which covers verify and close.

---

# 4. Data model

All tables use `TimestampMixin`. Master records (assets and PM plans) also use `SoftDeleteMixin`. Every model is registered in `core/audit_registry.py` via `register_audited(...)`, with child lines using `parent_attr`, so the audit trail is automatic. The older per-route `_write_audit()` pattern is not used.

Status and type values are **coded tuples in the model file**, following the no-metadata-customization rule. They are not admin-configurable tables.

## 4.1 `MaintenanceAsset` (`maintenance_assets`)

| Field | Notes |
|---|---|
| `asset_code` | Unique. **User-entered** because plants already have machine numbers. If left blank, it is auto-suggested as `EQ-NNNN`. |
| `name`, `description` | |
| `category` | `production_machine`, `material_handling` (EOT crane, forklift), `utility` (compressor, DG set, transformer, chiller), `tooling_fixture`, `instrument` (gauge or measuring device, used for calibration), `facility` (building, HVAC), `vehicle`, `other` |
| `parent_asset_id` | Self-FK, for sub-assemblies such as a machine's spindle or hydraulic unit |
| `branch_id` (required), `department_id`, `location_text` | Plant, owning department, and physical location such as "Bay 3, Line 2" |
| `workstation_id` | Nullable FK to `production_workstations`. Unique, so at most one asset per workstation. |
| `make`, `model`, `serial_number`, `year_of_manufacture` | |
| `supplier_vendor_id`, `purchase_date`, `purchase_cost`, `warranty_expiry`, `amc_vendor_id`, `amc_expiry` | Vendor FKs point to the existing vendor master |
| `criticality` | `A` (line stops if it fails), `B`, `C`. Drives notification urgency and the default request priority. |
| `status` | `operational`, `breakdown`, `under_maintenance`, `standby`, `decommissioned`. **System-managed** by work orders except for `standby` and `decommissioned`, which are set manually. |
| `meter_unit`, `current_meter_reading`, `meter_updated_at` | Running hours, cycles or km. Used for meter-based PM in Phase 3. |
| `commissioned_on`, `decommissioned_on`, `remarks` | |

Related child tables:
- `MaintenanceAssetSpare` (`maintenance_asset_spares`) holds the bill of spares for an asset: `asset_id`, `store_item_id`, `qty_per_replacement`, `is_critical` (keep minimum stock), and `remarks`.
- `MaintenanceAttachment` (`maintenance_attachments`) is one polymorphic attachment table (`entity_type`, `entity_id`) shared by assets (manuals, drawings, photos), requests (breakdown photos), work orders (service reports) and PM plans. It follows the P2P attachment columns: `doc_type`, `filename`, `content_type`, `size`, `sharepoint_path`, `sharepoint_url`, `created_by_id`. Files are stored in SharePoint under the root folder `Maintenance-media`.

## 4.2 `MaintenanceRequest` (`maintenance_requests`), number `MRQ-YYYY-NNNN`

| Field | Notes |
|---|---|
| `request_number` | Generated |
| `asset_id` | Required |
| `request_type` | `breakdown`, `abnormality` (noise, leak or vibration while still running), `improvement`, `safety` |
| `machine_down` | Boolean. If true, the downtime clock starts at `reported_at`. |
| `reported_at` | Defaults to now, but can be back-dated. For example, "it stopped at 02:10 on night shift". |
| `problem_description` | Required |
| `priority` | `low`, `normal`, `high`, `urgent`. Defaults from asset criticality combined with `machine_down`. |
| `status` | `open` → `acknowledged` → `converted` (to a work order), or `rejected` or `duplicate`, each with a required reason |
| `raised_by_id`, `acknowledged_by_id`, `acknowledged_at`, `work_order_id`, `rejection_reason` | |

## 4.3 `MaintenanceWorkOrder` (`maintenance_work_orders`), number `MWO-YYYY-NNNN`

The `WO-` prefix is already taken by Production.

| Field | Notes |
|---|---|
| `wo_number`, `asset_id`, `request_id` (nullable), `pm_plan_id` (nullable) | |
| `wo_type` | `breakdown`, `preventive`, `corrective`, `calibration`, `improvement`, `inspection` |
| `priority`, `title`, `description` | |
| `status` | See §5.2 |
| `assigned_to_id` (lead technician), `planned_start`, `planned_end`, `estimated_hours` | |
| `actual_start`, `actual_end` | |
| `downtime_start`, `downtime_end`, `downtime_minutes` (stored) | `downtime_start` comes from `request.reported_at` when `machine_down` is true. `downtime_end` is when the machine is handed back. |
| `failure_category` | Coded: `mechanical`, `electrical`, `hydraulic`, `pneumatic`, `lubrication`, `electronic_control`, `wear_and_tear`, `operator_error`, `external`, `other` |
| `root_cause`, `action_taken`, `hold_reason` | Required at completion for breakdown and corrective work orders |
| `external_vendor_id`, `external_cost` | For jobs done by an outside service engineer |
| `labour_cost`, `spares_cost`, `total_cost` | Recomputed by the service layer and never hand-edited |
| `completed_by_id`, `verified_by_id`, `verified_at`, `closed_at` | |

Child tables:
- `MaintenanceWorkOrderTask` holds checklist lines, copied from the PM plan or added ad hoc: `sequence`, `description`, `expected_value`, `result` (`ok`, `not_ok`, `na`), `measured_value`, `remarks`, `done_by_id`.
- `MaintenanceWorkOrderSpare` holds spares for the job: `store_item_id`, `location_id`, `qty_planned`, `qty_issued`, `qty_returned`, `unit_cost` (moving-average cost at issue time), and `reservation_id`. The reservation follows Production's `reserve_materials` / `consume_reservation` pattern.
- `MaintenanceLabourLog` holds labour entries: `technician_id`, `start_time`, `end_time`, `hours`, `hourly_rate`, `remarks`.

## 4.4 `MaintenancePmPlan` (`maintenance_pm_plans`), code `PM-NNNN`

| Field | Notes |
|---|---|
| `plan_code`, `asset_id`, `title`, `wo_type` | `wo_type` is `preventive`, `calibration` or `inspection` |
| `trigger_type` | `calendar` in Phase 2, `meter` in Phase 3 |
| `frequency_unit`, `frequency_value` | `day`, `week`, `month` or `year`, times N. For example, `month` with 3 means quarterly. |
| `meter_interval` | For meter-based plans in Phase 3 |
| `schedule_basis` | `fixed` (next due = last due + interval, which keeps the calendar steady) or `floating` (next due = last completion + interval) |
| `lead_days` | How many days before the due date the work order is generated |
| `next_due_date`, `last_done_date`, `last_work_order_id` | |
| `estimated_hours`, `default_assignee_id`, `is_active`, `requires_shutdown` | |

Child tables:
- `MaintenancePmPlanTask` holds the checklist template.
- `MaintenancePmPlanSpare` holds the spares kit, which is copied into the work order when it is generated.

## 4.5 Changes to other modules' tables (Phase 1)

None are required. The spares issue uses `reference_type = "maintenance_work_order"` and `reference_number = wo_number` on the existing Store ledger. This is free text, and the value will be added to the suggested tuple in `store/models/stock_transaction.py:30`. The workstation status is updated through the existing column.

---

# 5. Workflows

## 5.1 Breakdown (the main Phase 1 flow)

```
Requester raises MRQ (asset, machine_down=Y, photo)
   │  → notify Maintenance users of that plant (urgent if criticality A)
   │  → asset.status = breakdown; linked workstation = under_maintenance
   ▼
Planner acknowledges ──► converts to MWO (prefilled from request) ──► assigns technician
   │                        (or rejects/duplicate with reason → notify requester, restore asset status)
   ▼
Technician: Start ─► issue spares from Store ─► log labour ─► (On hold: waiting for spares/vendor)
   ▼
Technician: Complete (root cause, failure category, action taken required)
   │  → downtime_end = hand-back time; notify requester to confirm
   ▼
Requester confirms machine OK  ──► Planner verifies & closes
   → asset.status = operational; workstation = active; costs frozen
```

## 5.2 Work order status machine

`draft` → `assigned` → `in_progress` ⇄ `on_hold` → `completed` → `closed`.

`cancelled` can be reached from `draft`, `assigned` or `on_hold`, and requires a reason. A cancellation releases any reservations, and returns any issued spares or blocks the cancellation if spares were issued.

- All transitions happen through explicit action endpoints (`/start`, `/hold`, `/resume`, `/complete`, `/confirm`, `/close`, `/cancel`). A generic status PATCH is not allowed.
- An invalid transition returns 409 with the real reason, for example: "Can't close MWO-2026-0014: it's still In Progress. Mark it Completed first." This follows the real-error-messages rule.
- `completed` → `in_progress` (reopen) is allowed if the requester rejects the confirmation, and the rejection comment is recorded.

## 5.3 Preventive maintenance

- A daily APScheduler job, `backend/app/tasks/maintenance_pm_scheduler.py`, is registered in `main.py` next to the existing jobs at 06:00 `Asia/Kolkata`. For every active plan where `next_due_date - lead_days <= today` and no work order is open for that plan, it creates an `assigned` preventive work order. The work order copies the checklist and spares kit and is assigned to `default_assignee_id`, who is notified.
- When a PM work order is **closed**, the service updates the plan's `last_done_date` and computes `next_due_date` per `schedule_basis`.
- Overdue PM work orders (not completed by the due date) trigger a daily reminder to the assignee and the planner. It uses the existing "don't notify twice in one day" check against `Notification` from `hr_reminders.py`.
- The job is idempotent. It is keyed on (`pm_plan_id`, due date), so a restart or a second run on the same day creates nothing new.

## 5.4 Asset status sync (service-layer rule)

`maintenance/service.py:sync_asset_status(db, asset)` is the only place that writes `asset.status` and the linked workstation's `status`. It is called on every request or work-order transition.

- If any open `machine_down` request or work order exists for the asset, the asset becomes `breakdown` or `under_maintenance`, and the workstation becomes `under_maintenance`.
- Otherwise the asset becomes `operational` and the workstation becomes `active`. This does not happen if a user manually set the asset to `standby` or `decommissioned`.

## 5.5 Spares issue and return

- The technician or planner issues spares from a Store location against the work order. The service calls `post_stock_transaction(transaction_type="issue", reference_type="maintenance_work_order", ...)`, updates `qty_issued`, and snapshots `unit_cost`.
- If stock is short, `post_stock_transaction` raises `ValueError`. This surfaces as a 409 with the real numbers, for example: "Only 2 of 5 'Bearing 6205-2RS' available at Main Store. Issue 2 now or transfer stock in first."
- Unused spares are returned with `return_in`.
- Phase 2 adds a **"Raise PR"** shortcut for short spares. It pre-fills a P2P request with the item and quantity, so there is no separate purchase path. This is in line with the PRD risk of having multiple purchase paths.

---

# 6. Metrics (reports and dashboard)

| Metric | Definition |
|---|---|
| **Downtime** | Sum of `downtime_minutes` on breakdown work orders, by asset, plant or month |
| **MTTR** | Total breakdown downtime ÷ number of breakdown work orders in the period |
| **MTBF** | (Available hours − breakdown downtime hours) ÷ number of breakdowns. Available hours come from the linked workstation's `capacity_hours_per_day` × working days, falling back to the plant's `working_hours` / `working_days`. |
| **Availability %** | (Available hours − downtime) ÷ available hours |
| **PM compliance %** | PM work orders completed on or before the due date ÷ PM work orders due in the period |
| **Breakdown vs planned ratio** | Breakdown and corrective work orders compared with preventive, calibration and inspection work orders |
| **Maintenance cost** | Spares (issued − returned, at the snapshotted cost) + labour + external cost, by asset, plant or month |
| **Top 10 problem assets** | By breakdown count and by downtime |
| **Backlog** | Open work orders by age bucket and priority |

The dashboard (`/dashboard/maintenance`) shows these tiles and lists:
- Machines currently down, with a live downtime clock
- Open requests awaiting acknowledgement
- My assigned work orders
- PM due this week and overdue
- Critical spares below minimum stock

Charts follow the existing dashboard styling.

---

# 7. API design

All routers are prefixed `/maintenance/...`, tagged `["Maintenance"]`, and included in `main.py` with the `/api/v1` prefix.

| Router file | Endpoints |
|---|---|
| `routes/assets.py` | `GET/POST /maintenance/assets`, `GET/PATCH/DELETE /maintenance/assets/{id}`, `GET /{id}/history` (requests and work orders), `GET/PUT /{id}/spares`, `POST /maintenance/assets/import` (Excel, Phase 2) |
| `routes/requests.py` | `GET/POST /maintenance/requests`, `GET /{id}`, `POST /{id}/acknowledge`, `/convert`, `/reject` |
| `routes/work_orders.py` | CRUD plus `POST /{id}/assign`, `/start`, `/hold`, `/resume`, `/complete`, `/confirm`, `/reopen`, `/close`, `/cancel`; `POST /{id}/spares/issue`, `/spares/return`; `POST/DELETE /{id}/labour`; `PATCH /{id}/tasks/{task_id}` |
| `routes/pm_plans.py` | CRUD, `POST /{id}/generate-now` (manual trigger), `GET /maintenance/pm-plans/calendar?from=&to=` |
| `routes/spares.py` | `GET /maintenance/spares`: spare-part items with stock across locations, which assets use them, and whether they are below minimum. This is read-only over Store. |
| `routes/documents.py` | Upload, download (`/content` proxy) and delete attachments, copied from `quality/routes/documents.py` |
| `routes/dashboard.py`, `routes/reports.py` | Aggregates and CSV/Excel export |
| `routes/lookups.py` | Enums (categories, statuses, failure categories), assets for pickers, technicians |

Access control:
- Routes use `require_tab_access` / `require_tab_action("maintenance", <subtab>, <action>)` following the Production pattern.
- The request create and confirm endpoints use `require_any_app_access("maintenance", "production")`.
- Branch scoping follows the existing `DATA_ACCESS_SCOPES`.

---

# 8. Frontend

The frontend follows the Production module as the template.

| Route | Page |
|---|---|
| `maintenance/page.tsx` | Dashboard (§6) |
| `maintenance/assets/` `page`, `new`, `[id]`, `[id]/edit` | Asset list with plant, category, status and criticality filters. The detail view has tabs: **Overview · History · PM Plans · Spares · Documents**. |
| `maintenance/requests/` `page`, `new`, `[id]` | Request list and raise form. The raise form includes an asset picker, a machine-down toggle and a photo (using the existing `CameraCapture.tsx`), and is designed for a phone on the shop floor. |
| `maintenance/work-orders/` `page`, `new`, `[id]` | Work order list with a **My Jobs** toggle. The detail view shows a status stepper, action buttons, a checklist, a spares issue panel, labour log, downtime and costs. |
| `maintenance/schedule/` `page`, `new`, `[id]` | PM plans list plus a calendar or list view of upcoming due dates |
| `maintenance/spares/page.tsx` | Spares view (§7) |
| `maintenance/reports/page.tsx` | Reports (§6) with export |

Components in `frontend/src/components/maintenance/`:
- `MaintenanceNav.tsx` is copied and adapted from `ProductionNav`. It has a `TABS` array with `subtabKey`, `filterTabsByAccess`, `NotificationBell` and `TourButton`.
- `AssetForm.tsx`, `PmPlanForm.tsx`, `WorkOrderActions.tsx`, `SparesIssuePanel.tsx` and `MaintenanceStatusBadge.tsx`.

UI rules that apply to every page:
- The nav renders above the header.
- The "← Back" button uses the secondary pill style at the top-right of the header row.
- Use `ConfirmDialog` / `PromptDialog` and never browser dialogs. For example, the cancel and reject reasons go through `PromptDialog`.
- Error banners show the backend's real message.
- Forms follow `premnathrail-ui-behavior` for searchable selects, dates and uploads.

---

# 9. Wiring checklist

This is every file a new module touches. Missing items here have broken deploys before.

**Backend**
- [ ] `modules/maintenance/{models,routes,schemas}/__init__.py` and `service.py`
- [ ] Add `"maintenance"` to `AVAILABLE_APPS` in `main/models/user.py:10`
- [ ] Add a `MODULES["maintenance"]` entry with subtabs in `core/permission_registry.py`
- [ ] Import the models in **both** `backend/alembic/env.py` and `main.py`, and include the routers in `main.py`
- [ ] Add `register_audited(...)` for every model in `core/audit_registry.py`
- [ ] Alembic migration that creates the tables and seeds the `modules` row, with a DELETE in `downgrade()`, following `b7d2e4f6a8c1_add_production_module.py`. It chains off the **current** head. Today that is `c5d7e9f1a3b6`, but re-check `alembic heads` first because Production is still moving.
- [ ] Register the PM scheduler job in the `main.py` startup handler
- [ ] Add `"maintenance_work_order"` to the Store reference types tuple
- [ ] Add a `send_maintenance_breakdown_email` in `utils/email.py`, plus an optional `MAINTENANCE_EMAIL` setting in `core/config.py`
- [ ] `backend/app/tests/test_maintenance.py`

**Frontend**
- [ ] Add `'maintenance'` to the `AppModule` union in `types/index.ts:1` and to the literal union in `hooks/useAuth.ts:66` (`useRequireApp`)
- [ ] Add a Sidebar icon and entry in `components/Sidebar.tsx`
- [ ] Add a landing card in `app/dashboard/page.tsx`
- [ ] Add `maintenanceApi` in `lib/api.ts` and the interfaces in `types/index.ts`
- [ ] Add `ENTITY_LINK` entries (`maintenance_request`, `maintenance_work_order`, `maintenance_pm_plan`) in `components/erp/NotificationBell.tsx:9`
- [ ] Add tour configs in `lib/tour/configs/maintenance*.ts` and register them in `lib/tour/registry.ts`

**Docs**
- [ ] Turn this plan into `docs/02-modules/maintenance/overview.md` once built, and add a changelog entry

---

# 10. Notifications

Notifications use the existing `notify_user` / `broadcast_notification` helpers, which also send the Teams push. `notification_type` values:

| Type | Recipients | When |
|---|---|---|
| `maintenance_request_raised` | Maintenance users of the asset's plant. Filter by branch, don't broadcast to all maintenance users. Email as well if criticality is A and the machine is down. | Request created |
| `maintenance_request_rejected` | Requester | Rejected or duplicate |
| `maintenance_wo_assigned` | Assignee | Assigned or reassigned, including PM auto-generation |
| `maintenance_wo_completed` | Requester (to confirm) and planner | Completed |
| `maintenance_wo_confirmation_rejected` | Assignee and planner | Requester says the machine is not OK |
| `maintenance_pm_overdue` | Assignee and planner | Daily, once per day |
| `maintenance_spare_below_min` | Planner | A critical spare is below minimum after an issue |

---

# 11. Phased delivery

**Phase 1: Breakdown maintenance (MVP)**
- Module wiring (§9)
- Asset register (without Excel import)
- Requests
- Work orders with the full status machine
- Labour and downtime
- Spares issue and return through the Store ledger
- Asset and workstation status sync
- Attachments
- Notifications
- A basic dashboard (machines down, open requests, my jobs)
- Backend tests for the status machine, downtime maths, the stock-short path and the workstation sync

*Exit criterion:* a supervisor can raise a breakdown from their phone and a technician can fix and close it with spares issued. The machine is blocked in Production for the whole time it is down, and the downtime appears on the asset's history.

**Phase 2: Preventive maintenance and reporting**
- PM plans with checklists and spares kits
- The daily scheduler, the calendar view and overdue reminders
- Spares page with the asset bill of spares and below-minimum alerts
- The "Raise PR" shortcut to P2P
- Reports: MTTR, MTBF, availability, PM compliance, cost and top-10, with export
- Excel import of the existing machine list
- Guided tours

**Phase 3: Extensions** (each is independent and should be picked by need)
- Calibration of instruments and gauges, with certificate uploads and a due register (subject to Q2)
- Meter-based PM
- AMC and warranty tracking with expiry reminders
- Cost booking to cost centres or the `maintenance` internal order in Accounts
- QR asset tags that open "raise request for this asset" when scanned
- Multi-technician crews

---

# 12. Open questions (need answers before Phase 1)

1. **Asset scope.** The recommendation is to include all plant equipment: production machines, cranes, compressors, DG sets, utilities and facilities. IT and employee-issued assets stay in HR. Is that right?
2. **Calibration ownership.** ISO 9001 calibration of gauges and instruments often sits with Quality. Should it live in Maintenance (reusing the asset, PM plan and work order machinery), or be built later in Quality?
3. **Who raises breakdowns?** Sign-in is Microsoft SSO only, so operators without accounts can't raise requests. Is it acceptable for supervisors and shift in-charges to raise them, or do we need a shared shop-floor login or kiosk?
4. **Closure sign-off.** Should closing a breakdown work order require the requester's confirmation (as recommended), or can the maintenance head close alone?
5. **Maintenance store.** Is there a dedicated maintenance store location, or are spares issued from the plant's main store (`Branch.default_warehouse_id`)?
6. **Labour cost.** Should labour be costed with a per-technician hourly rate, a single maintenance rate per plant, or not costed at all (spares and external cost only)? Payroll is in ADP, so the portal has no salary data.
7. **Existing data.** Is there an Excel machine list or PM schedule to import on day one? If so, Excel import moves into Phase 1.
