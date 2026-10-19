# Maintenance Module — Overview

**Module:** Maintenance (plant maintenance / CMMS)
**App key:** `maintenance`
**Backend Location:** `backend/app/modules/maintenance/`
**Frontend Location:** `frontend/src/app/dashboard/maintenance/`
**Prepared by:** Vineet Sharma
**Date:** 7 October 2026
**Status:** Phase 1 (breakdown maintenance) shipped 30 September 2026. Phase 2 is built: PM plans and the daily scheduler, spares and the bill of spares with Raise PR, reports, and Excel import. Two Phase 3 items are also built: AMC & warranty tracking with expiry reminders, and QR asset tags. A **Settings** page (on the shared settings framework) was added for the values that used to be hard-coded. This document was checked against the code on 7 October 2026.

Design history and the original reasoning are in [plan.md](plan.md). The task-by-task guide for supervisors, technicians and the maintenance head is [user-guide.md](user-guide.md).

---

# 1. Purpose

The Maintenance module is the plant's maintenance management system (CMMS). It answers four questions:

1. **What equipment do we have, where is it, and what state is it in?** This is the asset register.
2. **What broke, how long was it down, and what fixed it?** This covers breakdown requests, work orders and downtime.
3. **What servicing is due, and did it happen on time?** This covers preventive maintenance (PM) plans.
4. **What did it cost, and which machines are the worst offenders?** This covers spares, labour, MTTR/MTBF and the reports.

It covers **our own plant equipment** only: production machines, cranes, compressors, DG sets, utilities, tooling, instruments and facilities. Employee-issued assets (laptops, SIMs, vehicles) stay in HR. Field service on customer machines stays in the Service (ERP) module.

The central design rule is that **Maintenance owns no stock.** Spare parts are Store items. Every spare used on a job is issued and returned through the Store stock ledger (`post_stock_transaction`, `reference_type = "maintenance_work_order"`). Maintenance only records which job consumed which spare, and at what cost.

> **ERP standard: why Maintenance owns no stock.**
> In SAP PM, Oracle eAM or Maximo, the maintenance module never keeps its own inventory. Spares are ordinary material master items, and a work order "consumes" them through a goods issue posted in Inventory Management. There are three reasons. First, there is **one stock figure**: if Maintenance kept its own count of bearings, it would drift from the Store count within a month and nobody would know which one is right. Second, **valuation**: the moment a spare leaves the shelf, its value moves from inventory (a balance-sheet asset) to maintenance expense. That movement has to happen in the one ledger Finance reconciles. Third, **purchasing**: reorder levels, PRs and POs are all driven off Store stock, so a spare that lives anywhere else would never be reordered. The work order only needs a pointer to the issue transaction and a cost snapshot.

---

# 2. How Maintenance relates to other modules

| Other module | What Maintenance uses | Direction |
|---|---|---|
| **Production** | `production_workstations`. An asset can link to at most one workstation. While the asset is down, the workstation is set to `under_maintenance`. Production's `ensure_workstation_available()` then blocks shop-floor use. | Maintenance writes the workstation status. If the Production module is missing, the sync does nothing. |
| **Store** | Item master (`store_items`), stock balances and the stock ledger. Spares are issued with `transaction_type="issue"` and returned with `"return_in"`. The minimum is the item's `minimum_stock`, or `reorder_level` when no minimum is set. | Maintenance posts to the ledger and never writes balances directly. |
| **P2P** | The **Raise PR** button on the Spares page opens a P2P request pre-filled with the short spares. | One-way hand-off. There is no separate maintenance purchase path. |
| **Organization** | `branches` (shown as "Plant"), `departments`, and `branch_user_assignments`, which decide which plant's alerts a user gets. The plant's `default_warehouse_id`, `working_days` and `working_hours` are also used. | Read only |
| **Accounts / Vendor master** | `vendors`, used for the supplier, AMC vendor and outside service vendor | Read only |
| **SharePoint** | Attachments are stored under the root folder `Maintenance-media/`. | Write |
| **Projects (PM)** | The **Project Work** tab shows department milestones and tasks from Project Management. This is the shared `DepartmentWork` / `MyTasks` component. | Display only. It has no maintenance logic. |

---

# 3. Roles and permissions

The module is gated by the app key `maintenance`. Fine-grained rights come from the standard permission registry (`core/permission_registry.py`, `MODULES["maintenance"]`), which an admin sets in the Permission Matrix. There are no extra role tables.

## 3.1 Subtabs

| Subtab key | Nav label | What it gates |
|---|---|---|
| `dashboard` | Dashboard | `GET /maintenance/dashboard` |
| `project_work` | Project Work | Project Management milestones and tasks for the Maintenance department |
| `assets` | Assets | Asset register, bill of spares, Excel import (`import` action), the QR label sheet, **and the AMC & Warranty page** (`/dashboard/maintenance/contracts`, which reuses this subtab; its Excel download needs `assets:export`) |
| `requests` | Requests | Acknowledging and rejecting requests (`edit`). Raising and confirming are **not** gated by this subtab (see 3.2). |
| `work_orders` | Work Orders | Work orders. `create` covers creating a work order and converting a request into one. `edit` covers assigning, starting, holding, resuming, completing, checklist, spares and labour. `approve` covers reopening, verifying and closing, and cancelling. |
| `schedule` | PM Schedule | PM plans and the calendar. `create` also covers **Generate now**. |
| `spares` | Spares | The read-only spares view over Store stock |
| `reports` | Reports | Report summary. `export` covers the Excel download. (The Permission Matrix labels this subtab "Maintenance Reports".) |
| `settings` | Settings | Shows the Settings tab in the nav. Any maintenance-app user can *read* the settings. **Editing** needs admin, an explicit `maintenance:settings:edit` grant, **or** an explicit `maintenance:work_orders:approve` grant (the planner). Explicit grants only: the matrix's "no grants means unrestricted" fallthrough does not make anyone an editor. See section 6.11. |

## 3.2 Typical roles

| Role | Typical person | Access needed |
|---|---|---|
| **Requester** | Production supervisor, shift in-charge | The `production` app is enough. The request endpoints, asset picker, lookups and request attachments accept `require_any_app_access("maintenance", "production")`. A non-maintenance user only sees requests they raised, and only they (or an admin) can confirm the repair. In the nav they only see the Requests tab. |
| **Technician** | Fitter, electrician | `maintenance` app, with `work_orders: view/edit` and `requests: view`. The technician picker lists active users who have the maintenance app and are not admins. |
| **Planner / Maintenance Head** | Maintenance in-charge | Everything above, plus `work_orders: create/approve`, `schedule: create/edit/delete`, `assets: create/edit/import`, and `reports: export`. **`work_orders:approve` is what makes someone a "planner".** In code (`service.maintenance_planners`) a planner is an active maintenance-app user of the plant (a user with no plant assignments covers every plant) for whom `can_perform(user, "maintenance", "work_orders", "approve")` is true. That check passes for admins and for any user with **no** maintenance grants at all in the Permission Matrix, so until the matrix is filled in, every unrestricted maintenance user counts as a planner. The PM overdue, below-minimum and AMC/warranty reminders go to these users (see section 8 for the exact rules). An explicit `work_orders:approve` grant also lets the planner edit Maintenance Settings. |
| **Plant Head / Management** | Plant head | `dashboard` and `reports` view (plus `export`) |

> **ERP standard: why the requester confirms, and someone else closes.**
> This is a three-party sign-off: the person who *reported* the fault, the person who *fixed* it, and the person who *verifies* it. No one marks their own work as done. In SAP PM this is the notification (raised by Production), the order (executed by Maintenance), and technical completion (TECO) by the planner. The requester's "yes, it's working" is what stops jobs from being closed on paper while the machine is still leaking.

---

# 4. Data model

All tables use `TimestampMixin`. Assets, PM plans and attachments also use `SoftDeleteMixin`. Every model is registered in `core/audit_registry.py`, so field changes reach `audit_logs` automatically. Status and type values are **coded tuples in the model files**. They are not admin-editable tables, following the no-metadata-customization rule.

Migrations: `9b88b67d6fcb_add_maintenance_module.py` (Phase 1) and `e7c4a1b9d2f5_maintenance_phase2_pm_spares.py` (Phase 2).

## 4.1 `maintenance_assets` (`MaintenanceAsset`)

| Column | Notes |
|---|---|
| `asset_code` | Unique. **User-entered**, because plants already have machine numbers. If left blank it is auto-numbered `EQ-NNNN`. Stored in upper case. |
| `name`, `description` | |
| `category` | `production_machine`, `material_handling`, `utility`, `tooling_fixture`, `instrument`, `facility`, `vehicle`, `other` |
| `parent_asset_id` | Self-FK for sub-assemblies, such as a spindle or hydraulic power pack |
| `branch_id` (required), `department_id`, `location_text` | Plant, owning department, and where it stands (for example "Bay 3, Line 2") |
| `workstation_id` | Nullable, **unique** FK to `production_workstations` |
| `make`, `model`, `serial_number`, `year_of_manufacture` | |
| `supplier_vendor_id`, `purchase_date`, `purchase_cost` | |
| `warranty_expiry`, `amc_vendor_id`, `amc_expiry` | These drive the AMC & Warranty page and the expiry reminders. **There is no separate contracts table**: no contract number, value, coverage or visit count. The warranty's vendor is the asset's `supplier_vendor_id` (the party it was bought from). The AMC's vendor is `amc_vendor_id`. |
| `criticality` | `A` = the line stops if it fails, `B` = important (the default), `C` = low impact |
| `status` | `operational`, `breakdown`, `under_maintenance`, `standby`, `decommissioned` (see 6.7) |
| `meter_unit`, `current_meter_reading`, `meter_updated_at` | Recorded now. Meter-based PM is a later Phase 3 item. |
| `commissioned_on`, `decommissioned_on`, `remarks`, `created_by_id` | The commissioning and decommissioning dates limit available hours in the reports. |

## 4.2 `maintenance_asset_spares` (`MaintenanceAssetSpare`): bill of spares

| Column | Notes |
|---|---|
| `asset_id` | Cascade delete with the asset |
| `store_item_id` | The Store item. No quantity is stored here. |
| `qty_per_replacement` | How many are fitted per change, for example 2 bearings |
| `is_critical` | "Never run out." A critical spare below the Store minimum shows on the dashboard and triggers the below-minimum reminder. |
| `remarks` | |

The whole list is replaced with `PUT /maintenance/assets/{id}/spares`. Rows that are kept are updated in place, so their audit history survives.

## 4.3 `maintenance_requests` (`MaintenanceRequest`), numbered `MRQ-YYYY-NNNN`

| Column | Notes |
|---|---|
| `request_number`, `asset_id` | |
| `request_type` | `breakdown`, `abnormality` (noise, leak or vibration while still running), `improvement`, `safety` |
| `machine_down` | If true, the downtime clock starts at `reported_at`. |
| `reported_at` | Defaults to now. It can be back-dated but not set in the future. |
| `problem_description` | Required |
| `priority` | `low`, `normal`, `high`, `urgent`. The default comes from criticality and machine-down (see 6.1). |
| `status` | `open` → `acknowledged` → `converted`, or `rejected` / `duplicate` with a reason |
| `raised_by_id`, `acknowledged_by_id`, `acknowledged_at`, `rejection_reason` | |

The link to the work order is one-way: `maintenance_work_orders.request_id`. The request has no `work_order_id` column.

## 4.4 `maintenance_work_orders` (`MaintenanceWorkOrder`), numbered `MWO-YYYY-NNNN`

The `WO-` prefix belongs to Production.

| Column | Notes |
|---|---|
| `wo_number`, `asset_id`, `request_id` (nullable) | |
| **`pm_plan_id`**, **`pm_due_date`** | Added in Phase 2. They are set when a PM plan generated the job. The pair (`pm_plan_id`, `pm_due_date`) has a **unique constraint** (`uq_maintenance_wo_pm_occurrence`), so one PM occurrence can only ever have one work order. It makes generation idempotent and is the basis of PM compliance. |
| `wo_type` | `breakdown`, `preventive`, `corrective`, `calibration`, `improvement`, `inspection` |
| `priority`, `title`, `description`, `status` | Status machine in 6.2 |
| `machine_down` | Whether the machine is out of service for this job. It drives the status sync and the downtime clock. |
| `assigned_to_id`, `planned_start`, `planned_end`, `estimated_hours` | |
| `actual_start`, `actual_end` | Stamped by Start and Complete |
| `downtime_start`, `downtime_end`, `downtime_minutes` | The start is copied from the request's `reported_at`. The end is the hand-back time entered at completion. The minutes are stored. |
| `failure_category` | `mechanical`, `electrical`, `hydraulic`, `pneumatic`, `lubrication`, `electronic_control`, `wear_and_tear`, `operator_error`, `external`, `other` |
| `root_cause`, `action_taken` | Required, together with `failure_category`, to complete a `breakdown` or `corrective` job |
| `hold_reason`, `cancel_reason` | |
| `external_vendor_id`, `external_cost` | For a job done by an outside service engineer |
| `labour_cost`, `spares_cost`, `total_cost` | Always recomputed by `service.recompute_costs`, never typed in |
| `requester_confirmed_at`, `requester_comment` | The requester's sign-off |
| `created_by_id`, `completed_by_id`, `verified_by_id`, `verified_at`, `closed_at` | |

Child tables:

- **`maintenance_work_order_tasks`**: checklist lines with `sequence`, `description`, `expected_value`, `result` (`ok`, `not_ok`, `na`), `measured_value`, `remarks`, `done_by_id`. They are copied from the PM plan or added by hand.
- **`maintenance_work_order_spares`**: `store_item_id`, `location_id`, `qty_planned`, `qty_issued`, `qty_returned`, `unit_cost`, `remarks`.
- **`maintenance_labour_logs`**: `technician_id`, `start_time`, `end_time`, `hours` (more than 0 and at most 24 per entry), `hourly_rate` (**optional**, default 0), `remarks`.

## 4.5 `maintenance_pm_plans` (`MaintenancePmPlan`), numbered `PM-NNNN`

The number is not yearly, because a plan lives for years.

| Column | Notes |
|---|---|
| `plan_code`, `asset_id`, `title`, `description` | The description is copied into each generated job as instructions. |
| `wo_type` | `preventive`, `calibration` or `inspection` |
| `trigger_type` | Only `calendar` today. `meter` comes later, and the column already exists so plans won't need migrating. |
| `frequency_unit`, `frequency_value` | `day`, `week`, `month` or `year`, times a value from 1 to 366. The UI labels them Daily, Weekly, Monthly, Quarterly (3 months), Half-yearly (6 months), Yearly, or "Every N …". |
| `meter_interval` | Reserved for meter-based PM |
| `schedule_basis` | `fixed` or `floating` (see 6.4) |
| `lead_days` | 0 to 365. The number of days before the due date that the job is raised. A new plan is pre-filled from Settings → "Default PM lead days" (3 unless changed). Each plan can override it. |
| `next_due_date` | Required. This is the due date of the next occurrence. |
| `last_done_date`, `last_work_order_id` | Updated when a PM job is closed |
| `estimated_hours`, `default_assignee_id` | |
| `requires_shutdown` | If true, the generated job is `machine_down`. The asset only goes down once the job is **started**. |
| `is_active`, `created_by_id` | Soft delete (`is_deleted`). A plan with an open job can't be deleted. Deleting a plan also sets `is_active = false`, and the jobs it already generated stay on record. A plan can't be created on, moved to, or re-activated on a decommissioned or deleted asset. A plan can't be moved to another asset while it has an open job. **Decommissioning the asset deactivates every active plan on it** (see 6.7). |

Child tables:

- **`maintenance_pm_plan_tasks`**: the checklist template (`sequence`, `description`, `expected_value`).
- **`maintenance_pm_plan_spares`**: the spares kit (`store_item_id`, `qty`, `remarks`). Each Store item appears at most once per plan.

## 4.6 `maintenance_attachments` (`MaintenanceAttachment`)

One polymorphic table: `entity_type` (`asset`, `request` or `work_order`) plus `entity_id`, together with `doc_type` (`photo`, `manual`, `drawing`, `service_report`, `certificate`, `other`), `filename`, `content_type`, `size`, `sharepoint_path`, `sharepoint_url`, `created_by_id` and `created_by_name`. Files are streamed through `/content`, so the raw SharePoint URL is never exposed. Requesters can attach files only to requests they raised. Asset and work-order files are for maintenance users only.

## 4.7 QR asset tags

The QR tag needs no new table. Each label's QR encodes the **scan resolver** URL `{FRONTEND_URL}/dashboard/maintenance/scan/{asset_code}`. It uses the asset **code**, not the database id, so a label survives a database restore, and a person can still read or type the code if the QR is damaged. The QR is drawn server-side with `segno` at error-correction level M (about 15% recovery), which survives shop-floor scuffs while staying small enough for the label.

The code lives in `routes/asset_tags.py` (endpoints in section 10). The scan page looks the code up case-insensitively and shows the machine, its plant, location, status, criticality and its open requests and work orders. A **decommissioned** asset still resolves, but the page says requests can't be raised on it and hides the Report Breakdown button (`can_raise_request = false`). The request endpoint refuses it too. A deleted asset returns "No asset with code …".

**Label layout** (`/dashboard/maintenance/assets/labels`): an A4 portrait sheet of 3 × 6 labels, each about 63 × 42 mm (fits common 18/21-up adhesive label stock). Each label shows the QR (30 mm), the asset code, the name, "plant · location", and the line "Scan to report a breakdown". At most 200 labels per sheet. A whole-plant sheet skips decommissioned assets. A sheet of explicitly selected assets prints whatever was selected.

---

# 5. Number series

| Series | Format | Scope |
|---|---|---|
| Request | `MRQ-YYYY-NNNN` | Restarts every calendar year |
| Work order | `MWO-YYYY-NNNN` | Restarts every calendar year |
| PM plan | `PM-NNNN` | Never restarts |
| Asset (auto) | `EQ-NNNN` | Only used when the code is left blank |

Every series takes a transaction-scoped Postgres advisory lock on its prefix, so two users saving at the same moment can't get the same number.

---

# 6. Workflows

## 6.1 Breakdown flow

```text
Requester raises MRQ (asset, machine down?, photo)              [phone; QR tag pre-fills the asset]
   │  priority defaults from criticality × machine down
   │  asset → breakdown, linked workstation → under_maintenance  (if machine down)
   │  bell → every maintenance user of that plant
   ▼
Planner: Acknowledge ─► Create Work Order (prefilled, downtime clock carried over) ─► assign technician
   │                    or Reject / Mark Duplicate (reason → requester; asset status recomputed)
   ▼
Technician: Start ─► asset → under_maintenance
            issue spares from Store ─► log labour ─► (On Hold ⇄ Resume: waiting for spares / vendor)
            fill checklist results
   ▼
Technician: Mark Completed — failure category, root cause, action taken; hand-back time
   │  downtime_end = hand-back time; downtime_minutes stored
   │  bell → requester ("please confirm"), work order creator
   ▼
Requester: "Yes, it's working"            or   "No, still a problem" (comment) → job back to In Progress
   ▼
Planner: Verify & Close ─► costs frozen; asset → operational, workstation → active (if nothing else open)
```

**Default priority** (`service.default_priority` → `settings.priority_for`). This applies when the requester leaves priority blank. The six values are Settings → "Breakdown requests". The defaults are:

| Criticality | Machine down | Machine running |
|---|---|---|
| A | urgent | high |
| B | high | normal |
| C | normal | normal |

**Request type to work order type on conversion:** `breakdown` → `breakdown`, `abnormality` → `corrective`, `improvement` → `improvement`, `safety` → `corrective`. The planner can override this.

## 6.2 Work order status machine

```text
            assign                 start              complete
  draft ───────────▶ assigned ───────────▶ in_progress ───────────▶ completed ───────────▶ closed
    │                   │                   │    ▲                   │   (verify & close)
    │                   │              hold │    │ resume            │
    │                   │                   ▼    │                   │ reopen (planner) or
    │                   │                 on_hold                    │ requester "not OK"
    │                   │                   │                        └──────▶ in_progress
    └───────────────────┴───────────────────┴──▶ cancelled (reason; only if no spares are still issued)
```

| Action | Endpoint | Allowed from | Permission | Rules |
|---|---|---|---|---|
| Assign / reassign | `POST /{id}/assign` | draft, assigned, in_progress, on_hold | `work_orders:edit` | Draft becomes Assigned. The new assignee is notified. |
| Start | `POST /{id}/start` | assigned | `edit` | A draft job must be assigned first. Stamps `actual_start`. |
| Hold | `POST /{id}/hold` | in_progress | `edit` | A reason is required. |
| Resume | `POST /{id}/resume` | on_hold | `edit` | |
| Complete | `POST /{id}/complete` | in_progress | `edit` | Every checklist line needs a result. Breakdown and corrective jobs need failure category, root cause and action taken. The hand-back time can't be in the future or before the machine went down. |
| Reopen | `POST /{id}/reopen` | completed | `work_orders:approve` | A reason is required. Clears `actual_end`, any confirmation and the downtime end. |
| Requester confirms | `POST /maintenance/requests/{rid}/confirm` | completed | Raiser or admin | `ok=true` stamps `requester_confirmed_at`. `ok=false` needs a comment and sends the job back to `in_progress`. |
| Close | `POST /{id}/close` | completed | `approve` | If the job came from a request, the requester must have confirmed first (409 otherwise). This rule is Settings → "Requester must confirm before close" (on by default). When it is off, the planner can close as soon as the job is Completed. Close stamps the verifier and `closed_at`, and rolls a PM plan forward. |
| Cancel | `POST /{id}/cancel` | draft, assigned, on_hold | `approve` | A reason is required. An in-progress job must be put on hold first. **Blocked while any spare is issued and not returned.** If the job came from a request, the request goes back to `acknowledged`. |

- A status can only change through these action endpoints. `PATCH /{id}` edits details only, and is refused once the job is closed or cancelled.
- An invalid move returns **409 with the real reason**, for example: "Can't close MWO-2026-0014: it's In Progress, and this needs Completed. Mark it Completed first."
- Labour can still be logged on a **completed** job (time is often entered afterwards). It can't be logged on a closed or cancelled job.
- Closed and cancelled jobs are locked: no edits, checklist changes, spares or labour.

> **ERP standard: why only action buttons change status.**
> Each transition carries side effects: it stamps a time, starts or stops the downtime clock, changes the asset and workstation status, and notifies someone. A free "status" dropdown would let a user skip from Assigned straight to Closed with no root cause, no hand-back time and no confirmation. That is exactly how CMMS data turns to fiction. SAP uses the same idea: a user can't type "TECO", they run the Technically Complete transaction, and it runs its checks.

## 6.3 Request statuses

`open` → `acknowledged` → `converted`, or `open`/`acknowledged` → `rejected` / `duplicate` (a reason is required and the requester sees it). Acknowledge and reject need `requests:edit`. Convert needs `work_orders:create`. All three require the user to hold the maintenance app. If the work order is cancelled, the request goes back to `acknowledged` so it can be converted again or rejected.

## 6.4 Preventive maintenance: generation and roll-forward <!-- verify against code -->

**Generation** (`service.run_pm_plan` → `generate_pm_work_order`). The daily scheduler and the **Generate now** button run the same code. For each active, non-deleted plan:

1. If the plan already has an open job (draft, assigned, in_progress or on_hold), nothing happens. One plan has at most one open job.
2. If a job already exists for the current `next_due_date`:
   - **Cancelled**: that occurrence was skipped on purpose. `next_due_date` moves forward one interval (this is logged), and the check repeats.
   - **Closed** but the plan didn't roll forward: the roll-forward runs now.
   - **Completed** but not closed: the result is "waiting for close", and nothing new is raised.
3. If `next_due_date − lead_days` is still in the future, nothing happens. **Generate now** ignores this check.
4. Otherwise a work order is created for (plan, `next_due_date`):
   - `wo_type` comes from the plan, and `title` is the plan title. The description is the plan instructions plus "Generated from PM plan PM-0003, due 15-10-2026."
   - Priority is `high` for a criticality A asset and `normal` otherwise.
   - Status is `assigned` to the plan's default technician (who is notified). If there is no default technician, or they are inactive, the status is `draft` and the description says the job needs assigning.
   - Planned start and planned end are both the due date.
   - `machine_down = requires_shutdown`. The asset does **not** go down until the job is started. A planned PM shutdown does not run the breakdown downtime clock.
   - The checklist is copied. The spares kit is copied as `qty_planned` at the plant's default warehouse, or the plant's first active Store location if there is no default. If the plant has no Store location, the kit is not copied and the description says why.
   - A decommissioned or deleted asset raises a real error ("Deactivate the plan").

**Idempotency.** (`pm_plan_id`, `pm_due_date`) identifies an occurrence. A second run on the same day, or a server restart, creates nothing new.

**Roll-forward** (`service.advance_pm_plan`). This runs only when a PM job is **closed**, never when it is completed or cancelled. It does two things:

- It sets `last_done_date` to the completion date (`actual_end` in IST) and `last_work_order_id`.
- It moves `next_due_date` forward one interval:

| Basis | Next due = | Example: monthly, due 10 Oct, done 18 Oct |
|---|---|---|
| `fixed` | **due date** + interval | 10 Nov |
| `floating` | **completion date** + interval | 18 Nov |

If someone already moved the plan past this occurrence by hand, the plan is not dragged back. Month arithmetic clamps to the end of the month, so 31 Jan + 1 month = 28 or 29 Feb.

**Overdue.** A PM job still open after its `pm_due_date` triggers a daily reminder (see section 8).

> **ERP standard: fixed versus floating PM.**
> SAP calls these "time-based" (fixed) and "performance/completion-based" (floating) scheduling. Use **fixed** when the date itself matters: statutory inspections (crane load test, pressure vessel, fire extinguisher), calibration certificates, or anything you plan shutdowns around. A late job doesn't push the next one back, so the calendar never drifts. Use **floating** when what matters is the gap between services: an oil change every 3 months of running, or a filter change. Doing it late simply restarts the interval, and you never service twice in a fortnight. When in doubt, choose fixed. It keeps the PM calendar predictable, and PM compliance stays meaningful.

> **ERP standard: preventive versus breakdown ratio.**
> The maintenance mix is the share of planned work (preventive, calibration, inspection) against unplanned work (breakdown, corrective). World-class plants run at about 80% planned or better. A plant at 30% planned is firefighting: every job is urgent, spares are bought at a premium, and machines fail at the worst moment. The ratio is the leading indicator. PM compliance goes up first, the planned share follows, and only then do MTBF and availability improve. The Reports page shows this as "Breakdown vs Planned" and "Planned share %".

## 6.5 Spares issue and return through the Store ledger

- **Plan a spare** (`POST /{id}/spares`): adds or updates a line with `qty_planned` at a Store location. Nothing moves in stock.
- **Issue** (`POST /{id}/spares/issue`): allowed while the job is assigned, in progress or on hold. It posts `post_stock_transaction(transaction_type="issue", reference_type="maintenance_work_order", reference_number=<MWO number>)`. If stock is short, the issue is refused with 409 and the real numbers, for example: "Only 2 of 5 'Bearing 6205-2RS' available at Main Store. Issue 2 now or transfer stock in first." "Available" means on hand minus reserved at that location.
- **Unit cost snapshot**: the item's `standard_cost`, falling back to `moving_average_cost`, at the time of issue. It is weighted across repeat issues on the same line.
- **Return** (`POST /{id}/spares/return`): posts `return_in` for unused quantity. You can't return more than is still out. A line with any issued quantity can't be deleted.
- After every issue, `check_spare_below_min` runs. If the item is **critical** on any asset's bill of spares and its total on hand across all stores is now below the minimum, the plant's planners get a reminder (bell + Teams, at most once per item per planner per day). A failure in this alert never undoes the issue.
- **Spares cost** = Σ (issued − returned) × unit cost.

## 6.6 Bill of spares, Spares page and Raise PR <!-- verify against code -->

- Each asset keeps a **bill of spares**: which Store items it uses, how many per replacement, and whether each is critical.
- The **Spares page** (`GET /maintenance/spares`) lists every Store item that is `item_type = spare_part` or appears on any bill of spares. For each item it shows:
  - stock by location (Store balances, never a copy), the total on hand, and the minimum, reorder level and reorder quantity
  - which assets use it, and whether it is critical
  - consumption in the last 90 days (maintenance issues minus returns on the ledger)
  - a stock state: Below min / At reorder / OK / No min set

  Filters: plant, store, search, below-minimum only, critical only. Critical below-minimum items sort first.
- **Raise PR**: for a user who also has the `p2p` app, this opens `/dashboard/p2p/new` pre-filled with the item and a suggested quantity. A multi-select can raise one PR for several items. The suggested quantity is the Store reorder quantity, or else the shortfall up to the reorder level (or minimum), rounded up. Users without P2P are told to ask someone who has it.

## 6.7 Asset and workstation status sync

`service.sync_asset_status(db, asset)` is the **only** code that writes the system-managed states. It runs after every request and work-order transition, after spares and labour changes, and after asset edits.

| Condition (open = draft, assigned, in_progress, on_hold) | Asset status | Linked workstation |
|---|---|---|
| Any open machine-down job is **in_progress** | `under_maintenance` | `under_maintenance` |
| Otherwise, any open machine-down job, or any open or acknowledged machine-down request. PM jobs only count once started. | `breakdown` | `under_maintenance` |
| Nothing open, and the asset was breakdown or under maintenance | `operational` | `active` |
| Asset is `standby` or `decommissioned` | Unchanged (a manual state wins) | Unchanged |

- Users can set only `operational`, `standby` and `decommissioned` by hand, and not while the asset is down. Setting `decommissioned` stamps `decommissioned_on`.
- The workstation is only moved between `active` and `under_maintenance`. A workstation someone set `inactive` is never re-activated.
- If an asset's workstation link changes or the asset is deleted, the old workstation is released.
- An asset with any request or work order history can't be deleted. Set it to Decommissioned instead.

## 6.8 AMC and warranty tracking <!-- verify against code -->

- The **AMC & Warranty** page (`/dashboard/maintenance/contracts`, under the `assets` subtab) lists assets by warranty expiry and AMC expiry, with the AMC vendor. It shows which cover is active, expiring soon, or expired.
- The data is the asset's `warranty_expiry`, `amc_vendor_id` and `amc_expiry`, edited on the asset form under "Warranty, AMC & Meter".
- A daily job at **06:15 IST** (`tasks/maintenance_amc_reminders.py`) reminds the plant's maintenance planners ahead of an expiry. This is a reminder, so it goes to the **bell and Teams**, at most once per user, asset and day. Check the reminder windows (days before expiry) and recipients against the code when the build lands.

> **ERP standard: why track AMC and warranty on the asset.**
> A breakdown under warranty or AMC should cost spares and labour of zero. The vendor pays. Without the expiry on the asset record, the technician fixes it in-house and the cover is wasted. Equally, an AMC that lapses unnoticed leaves a critical machine with no service backup. Expiry reminders turn the renewal into a planned purchase instead of a surprise.

## 6.9 QR scan-to-report <!-- verify against code -->

1. The maintenance team prints a QR label for each asset from the asset register and sticks it on the machine.
2. A supervisor scans it with the phone camera. The phone opens `/dashboard/maintenance/requests/new?asset=<id>` and Microsoft SSO login happens if needed.
3. The "Report a Problem" form opens with the machine already selected. They tick **Machine is stopped**, describe the problem, add a photo and submit.

There is no separate scan endpoint for raising: a scan is just the normal create-request call, so all the request rules apply. Requesters need the `production` or `maintenance` app.

> **ERP standard: why QR tags.**
> Most wrong-asset bookings happen at the moment of reporting, when the user picks "CNC-07" instead of "CNC-17" from a long list. A tag on the machine removes that choice, makes raising a request take seconds, and ensures downtime lands on the right asset's history. That history is what MTBF and the top-10 list are built on.

## 6.10 Excel import of the machine list <!-- verify against code -->

- `GET /maintenance/assets/import-template` downloads a template with an `Assets` sheet and a help sheet.
- `POST /maintenance/assets/import?dry_run=true` checks every row and saves nothing. `dry_run=false` imports **all rows in one transaction, or nothing** if any row has an error.
- Columns: `asset_code`, `name`*, `category`*, `plant`*, `department`, `location`, `make`, `model`, `serial_number`, `year_of_manufacture`, `criticality`, `commissioned_on`, `workstation_code`, `remarks` (* = required). Common header aliases are accepted, such as `machine_no` and `branch`. Category can be the code or the label. Plant can be the name or the code. A blank code becomes `EQ-NNNN`. A duplicate code, in the file or already in the register, is an error.
- At most 2,000 rows per file. Only `.xlsx` and `.xlsm` files are accepted. Needs `assets:import`.

---

# 7. Metrics

The maths is in `backend/app/modules/maintenance/reporting.py`. The Reports page and `GET /maintenance/reports/summary` use it, and the definitions are returned in the payload so the UI shows the same text. All dates are in IST. The period defaults to the first of the current month through today.

| Metric | Exact definition |
|---|---|
| **Downtime** | Minutes machines were down on **`breakdown`-type** work orders (`machine_down` with a `downtime_start`; cancelled jobs excluded), **clamped to the period**. A breakdown that started last month counts only the part inside this period. One that is still open counts up to now. |
| **Breakdowns** | Breakdown work orders, not cancelled, whose downtime start falls in the period. If no downtime was recorded, the actual start or the created date is used instead. |
| **MTTR** (mean time to repair) | Σ full downtime minutes of breakdowns that **started in the period and have been handed back** ÷ the number of those breakdowns. The full repair time is used, not the clamped minutes, so a repair across month-end doesn't look artificially short. Lower is better. |
| **Available hours** | For each asset: hours per day × working days in the period up to today. Hours per day come from the linked workstation's `capacity_hours_per_day`, else the plant's `working_hours` (for example "09:00–18:00" gives 9), else 8. Working days come from the plant's `working_days`, else Mon–Sat. **Holidays are not deducted.** Days before `commissioned_on` or after `decommissioned_on` don't count. The report states which basis each asset used. |
| **MTBF** (mean time between failures) | (Available hours − breakdown downtime hours) ÷ breakdowns. Higher is better. |
| **Availability %** | (Available hours − breakdown downtime hours) ÷ available hours × 100. Planned PM shutdowns don't count against it. |
| **PM compliance %** | Of PM work orders with `pm_due_date` in the period (cancelled excluded): **done on time** ÷ (on time + late + missed) × 100. "Done" means the completion date (`actual_end`, IST) on or before the due date. "Missed" means still open after the due date. Jobs not yet due are left out. |
| **Breakdown vs planned** | Jobs **raised** in the period: breakdown + corrective against preventive + calibration + inspection. Planned share % = planned ÷ (breakdown + planned). Improvement jobs are counted separately as "other". |
| **Maintenance cost** | For jobs **completed or closed** in the period: spares (issued − returned, at the issue-time cost) + labour (hours × hourly rate) + external vendor cost. It is broken down by month and by asset. |
| **Top 10 problem assets** | Two lists: by breakdown count and by downtime minutes |
| **Backlog** | Open jobs right now (draft, assigned, in_progress, on_hold) by age (0–2, 3–7, 8–30 and more than 30 days since creation) × priority |
| **Failure Pareto** | Breakdown and corrective jobs in the period, grouped by `failure_category` ("not_recorded" if blank), with count, downtime and cumulative % |

**Labour cost is optional.** Payroll is in ADP, so the portal has no salary data. `hourly_rate` defaults to 0, which tracks hours without costing them. Enter a rate only if the plant agrees on a standard maintenance rate.

**Dashboard figures** are a separate, lighter calculation:
- **Last 30 days**: breakdown jobs completed or closed with `actual_end` in the last 30 days. Downtime is the sum of their `downtime_minutes`, and MTTR is that sum ÷ the job count.
- **This month**: the same `compute_summary` used by the Reports page, from the 1st of the month to today.

> **ERP standard: what MTBF and MTTR tell management.**
> **MTBF** answers *how reliable is this machine?* If a press runs 200 hours between failures and its PM interval is 400 hours, the PM is too infrequent, or it is the wrong PM. Rising MTBF is the proof that preventive work is paying off. **MTTR** answers *how good are we at fixing it?* High MTTR usually means waiting, not wrenching: no spare in stock, no technician on shift, or a vendor who didn't turn up. Read MTTR next to the On Hold reasons and the Spares page. **Availability** combines the two (roughly MTBF ÷ (MTBF + MTTR)) and is the number Production cares about. Always read these per asset and against the top-10 list. A plant average hides the one machine that causes half the downtime.

---

# 8. Notifications

All notifications go through `notify_user`. **Teams is opt-in (`teams=True`) and is used only for approvals and reminders.** Raised, assigned, completed and confirmed notices are bell-only. Users with notifications switched off get nothing. The actor never notifies themselves.

| `notification_type` | Recipients | When | Channel |
|---|---|---|---|
| `maintenance_request_raised` | Every active maintenance-app user of the asset's plant. A user with no plant assignments counts as covering all plants. The title is prefixed "URGENT:" and suffixed "MACHINE DOWN" when applicable. | Request created | Bell |
| `maintenance_request_rejected` | Requester | Rejected or marked duplicate (the reason is in the message) | Bell |
| `maintenance_wo_assigned` | Assignee | Job created with an assignee, assigned or reassigned, converted from a request with an assignee, or a PM job auto-generated | Bell |
| `maintenance_wo_completed` | Requester ("please confirm", links to the request) and the work order creator | Marked completed | Bell |
| `maintenance_wo_confirmed` | Work order creator and the request's acknowledger | Requester confirms the machine is OK | Bell |
| `maintenance_wo_confirmation_rejected` | Assignee and work order creator | Requester says it is still not OK (the job is reopened) | Bell |
| `maintenance_pm_overdue` | Assignee and the plant's planners (`work_orders:approve`, excluding admins) | Daily at 06:00 for each PM job open past its due date. At most once per user, job and day. | **Bell + Teams** (reminder) |
| `maintenance_spare_below_min` | The plant's planners (`work_orders:approve`) | After an issue leaves a **critical** spare below its Store minimum. At most once per item, planner and day. | **Bell + Teams** (reminder) |
| AMC / warranty expiry <!-- verify against code: final notification_type name and recipients --> | The plant's planners | Daily at 06:15, ahead of expiry | **Bell + Teams** (reminder) |

Bell links: `maintenance_request` → request page, `maintenance_work_order` → work order page, `maintenance_pm_plan` → PM plan page (registered in `NotificationBell.tsx`).

---

# 9. Scheduled jobs

Both jobs run on the app's `BackgroundScheduler(timezone="Asia/Kolkata")` and are registered in `main.py` at startup.

| Job id | Time (IST) | Code | What it does |
|---|---|---|---|
| `maintenance_pm_scheduler` | 06:00 daily | `tasks/maintenance_pm_scheduler.py` → `run_maintenance_pm_scheduler` | 1. Generates due PM work orders (6.4). Each plan is committed on its own, so one bad plan can't stop the rest. 2. Sends PM overdue reminders. It logs counts: generated, already open, awaiting close, not due, failed, and reminders sent. |
| `maintenance_amc_reminders` | 06:15 daily | `tasks/maintenance_amc_reminders.py` → `send_maintenance_amc_reminders` | AMC and warranty expiry reminders (6.8). <!-- verify against code: currently a stub that only logs "not implemented yet" --> |

Both jobs are safe to run twice. Generation is keyed on (plan, due date), and the reminders check whether a notification was already sent that day.

---

# 10. API endpoints

All routes are under `/api/v1`, tagged `Maintenance`.

**Assets**: `routes/assets.py`. The router needs the `maintenance` app.
| Method and path | Permission |
|---|---|
| `GET /maintenance/assets?branch_id&category&status&criticality&search` | `assets` view |
| `POST /maintenance/assets` | `assets:create` |
| `GET /maintenance/assets/{id}` | app |
| `PATCH /maintenance/assets/{id}` | `assets:edit` |
| `DELETE /maintenance/assets/{id}` (soft delete; refused if the asset has history or sub-assets) | `assets:delete` |
| `GET /maintenance/assets/{id}/history` (requests and work orders, newest first) | app |
| `GET /maintenance/assets/{id}/spares` / `PUT …/spares` (replace the bill of spares) | `assets` view / `assets:edit` |
| `GET /maintenance/assets/import-template` | `assets` view |
| `POST /maintenance/assets/import?dry_run=true\|false` (multipart `file`) | `assets:import` |

**Requests**: `routes/requests.py`. The router accepts the `maintenance` **or** `production` app.
| Method and path | Permission |
|---|---|
| `GET /maintenance/requests?status&asset_id&branch_id&mine&search` | Non-maintenance users only see their own |
| `POST /maintenance/requests` | Either app |
| `GET /maintenance/requests/{id}` | Raiser or maintenance user |
| `POST /maintenance/requests/{id}/acknowledge` | `requests:edit` + maintenance app |
| `POST /maintenance/requests/{id}/reject` (`status`: rejected or duplicate, `reason`) | `requests:edit` + maintenance app |
| `POST /maintenance/requests/{id}/convert` | `work_orders:create` + maintenance app |
| `POST /maintenance/requests/{id}/confirm` (`ok`, `comment`) | Raiser or admin |

**Work orders**: `routes/work_orders.py`. The router needs the `maintenance` app.
| Method and path | Permission |
|---|---|
| `GET /maintenance/work-orders?status&open_only&mine&asset_id&branch_id&wo_type&search` | `work_orders` view |
| `POST /maintenance/work-orders` | `work_orders:create` |
| `GET /maintenance/work-orders/{id}` / `PATCH /{id}` (details only) | app / `edit` |
| `POST /{id}/assign`, `/start`, `/hold`, `/resume`, `/complete` | `edit` |
| `POST /{id}/reopen`, `/close`, `/cancel` | `approve` |
| `POST /{id}/tasks`, `PATCH /{id}/tasks/{task_id}`, `DELETE /{id}/tasks/{task_id}` | `edit` |
| `POST /{id}/spares` (plan), `DELETE /{id}/spares/{spare_id}` | `edit` |
| `POST /{id}/spares/issue`, `POST /{id}/spares/return` | `edit` |
| `POST /{id}/labour`, `DELETE /{id}/labour/{log_id}` | `edit` |

**PM plans**: `routes/pm_plans.py` <!-- verify against code -->
| Method and path | Permission |
|---|---|
| `GET /maintenance/pm-plans?asset_id&branch_id&is_active&due_within_days&overdue&search` | `schedule` view |
| `POST /maintenance/pm-plans` (with `tasks[]` and `spares[]`) | `schedule:create` |
| `GET /maintenance/pm-plans/{id}` (with the last 15 jobs and their on-time flag) | `schedule` view |
| `PATCH /maintenance/pm-plans/{id}` (passing `tasks` or `spares` replaces them) | `schedule:edit` |
| `DELETE /maintenance/pm-plans/{id}` (refused while a job is open) | `schedule:delete` |
| `POST /maintenance/pm-plans/{id}/generate-now` | `schedule:create` |
| `GET /maintenance/pm-plans/calendar?from&to&branch_id&asset_id` (at most 400 days; generated jobs plus projected due dates) | `schedule` view |

**Spares, dashboard, reports, lookups and attachments**
| Method and path | Permission |
|---|---|
| `GET /maintenance/spares?branch_id&location_id&search&below_min_only&critical_only` | `spares` view |
| `GET /maintenance/dashboard?branch_id` | `dashboard` view |
| `GET /maintenance/reports/summary?from&to&branch_id&asset_id&category` (at most 3 years) | `reports` view |
| `GET /maintenance/reports/export?…&format=xlsx` (one sheet per metric) | `reports:export` |
| `GET /maintenance/lookups` (enums, plants, departments, workstations, technicians, store locations, vendors) | maintenance or production app |
| `GET /maintenance/lookups/assets?search&branch_id` (picker for the request form) | maintenance or production app |
| `GET /maintenance/lookups/store-items?search&location_id` | maintenance app |
| `GET /maintenance/attachments?entity_type&entity_id`, `POST /maintenance/attachments` (multipart), `GET /{id}/content`, `DELETE /{id}` | maintenance or production app, with the entity rules in 4.6 |

**AMC & warranty and QR tags** <!-- verify against code -->
`routes/contracts.py` (AMC & Warranty page data) and `routes/asset_tags.py` (QR label generation) are registered in `main.py` under `/maintenance`. Their endpoints are being written. Fill this table in from the code.

---

# 11. Frontend pages

| Route | Page |
|---|---|
| `/dashboard/maintenance` | Dashboard: counts, machines down with a live clock, open requests, my jobs, jobs awaiting close, last-30-days and this-month KPIs, PM due this week, PM overdue, critical spares below minimum |
| `/dashboard/maintenance/project-work` | Project Management milestones and tasks for the department |
| `/dashboard/maintenance/requests`, `/new`, `/[id]` | Request list, the phone-friendly "Report a Problem" form (accepts `?asset=`), and request detail with Acknowledge, Create Work Order, Reject, Mark Duplicate and the requester's confirm buttons |
| `/dashboard/maintenance/work-orders`, `/new`, `/[id]` | List with **My jobs** and **Hide closed** filters. The detail page has a status stepper, action buttons, checklist, spares (plan, issue, return), labour, downtime and costs. |
| `/dashboard/maintenance/assets`, `/new`, `/[id]`, `/[id]/edit` | Register with filters and **Import from Excel**. The detail page has Overview, History and Documents tabs. The bill of spares panel (`AssetSparesPanel`) exists but is not yet placed on the page. <!-- verify against code: plan.md also lists PM Plans and Spares tabs on the asset --> |
| `/dashboard/maintenance/schedule`, `/new`, `/[id]`, `/[id]/edit` | PM plan list and calendar, and the plan form (checklist and spares kit) <!-- verify against code --> |
| `/dashboard/maintenance/spares` | Spares view with Raise PR |
| `/dashboard/maintenance/contracts` | AMC & Warranty <!-- verify against code --> |
| `/dashboard/maintenance/reports` | Reports with Excel export |

Shared components are in `frontend/src/components/maintenance/`: `MaintenanceNav`, `AssetForm`, `AssetSparesPanel`, `AssetImportDialog`, `PmPlanForm`, `MaintenanceAttachments`, `FormDialog` and `labels.ts`. Every page follows the app-wide rules: the nav sits above the header, the "← Back" pill is top-right, reasons are collected with `ConfirmDialog` / `PromptDialog` (never browser dialogs), and error banners show the backend's real message.

---

# 12. What this module does not do

- It does not hold stock, create PRs or POs itself, or post accounting entries. Booking cost to a cost centre or the Accounts `maintenance` internal order is a later Phase 3 item.
- It does not track employee-issued assets (HR) or customer machines (Service / ERP).
- It has no meter-based PM, calibration certificate register or multi-technician crews yet. These are Phase 3, picked by need.
- It does not reserve spares for planned jobs. Planned quantities on a work order don't hold Store stock. Stock is only committed when it is issued.
- It does not email on breakdowns. Plan §9 listed `send_maintenance_breakdown_email`, but it isn't built. Alerts are bell-only.

---

# 13. Related documentation

- [Maintenance plan](plan.md): the design decisions and phase scope
- [Maintenance user guide](user-guide.md)
- [Store overview](../store/overview.md): the stock ledger that every spares movement goes through
- [P2P overview](../p2p/overview.md): where Raise PR lands
- [Changelog](../../09-operations/changelog.md)
