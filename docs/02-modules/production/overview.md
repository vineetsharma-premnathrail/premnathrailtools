# Production Module — Overview

**Module:** Production (BOM & routing, work orders, shop floor, planning, RRV builds)
**App key:** `production`
**Backend Location:** `backend/app/modules/production/`
**Frontend Location:** `frontend/src/app/dashboard/production/`
**Prepared by:** Vineet Sharma
**Date:** 7 October 2026
**Status:** Built and in use: BOM & routing (versions, standard cost), workstations, work orders (reservation, issue, return, finished-goods receipt), shop-floor time logs, planning, reports, RRV builds (12 gated stages, tests, rework, handover with a managed Word certificate). Quality Phase 2 (commit `aa9b49f`, 6 October 2026) added in-process gate lots, the FAI release check and the final-inspection lot on receipt. Dispatch is blocked by Quality rule 8 in Store.

This page is written from the code. The RRV design note is [rrv-build.md](rrv-build.md) (30 September 2026); where it disagrees with this page, this page is current (see §13). Planned next work (multi-level MRP, settlement, scrap reasons, finite capacity, plant scoping) is in [next-phase-plan.md](next-phase-plan.md).

---

# 1. Purpose

Production answers five questions:

1. **How is the product made?** The BOM (what goes in) and the routing (which steps, on which workstation, how many hours). See §4.1.
2. **What are we building right now, and is the material there?** Work orders, with Store reservations, issues and returns.
3. **What is happening on the shop floor?** The operation queue and time bookings.
4. **What will it cost, and what did it cost?** Standard cost on the BOM, estimated vs actual on each work order.
5. **Where is RRV #14, what is left, and can it be handed over?** The RRV Build: one record per vehicle, 12 gated stages, tests, rework, handover.

The central design rule is that **Production owns no stock and no inspections.** Components, finished goods and reservations live in the Store ledger (`post_stock_transaction`, `reference_type = "work_order"`, `reference_number = WO number`). Inspections live in Quality (gate lots, final lots, FAI). Production records *which order consumed what* and *which gate it is waiting for*.

> **ERP standard: BOM vs routing.**
> The **BOM** answers "what": the components and quantities for one unit (or a base quantity) of the product. The **routing** answers "how": the ordered operations, the work centre each runs on, and the setup and run times. SAP keeps them as two objects (CS01 BOM, CA01 routing) tied to one material. Here one `production_boms` row holds both: `production_bom_items` is the BOM, `production_bom_operations` is the routing. That's fine for a one-product, one-plant shop. The important part is the separation of meaning: materials drive Store (reservation, issue, MRP); operations drive capacity (workstation load), labour cost and quality gates. A BOM with no routing can't be released (§6.2), because the shop floor would have nothing to do.

---

# 2. How Production relates to other modules

Mapped against the cross-module checklist in `docs/MODULE_DETAILED_PLAN.md` §24.

| §24 row / other module | What exists in code | Direction |
|---|---|---|
| **Store → Production (Issue)** | Components and products are Store items (`store_items`). Release reserves stock (`store_stock_reservations`, visible and cancellable on Store's Reservations page). Issue posts `issue`, return posts `return_in`, finished goods post `receipt`, all with `reference_type = "work_order"`. | Production posts to the ledger; never writes balances directly. |
| **Production → Quality (stage complete / final)** | A routing step with `requires_inspection` is a **gate**: Request Inspection creates an in-process inspection **lot** (`production_gates.request_gate_lot`). Receive Output of a final-inspected product creates a **final lot** in Quality stock. The RRV build requests a **final vehicle inspection** (legacy `quality_inspections`, prefix `FIN`). | Production requests; Quality decides. |
| **Quality → Production (fail → rework)** | A rejected gate lot on a work order that belongs to an RRV build raises a rework order linked to the NCR (`on_gate_lot_decided`). A failed final vehicle inspection raises a rework order (`rrv_on_inspection_result`). A failed vehicle test raises one too. | Automatic. |
| **Quality rule 9 (FAI)** | `check_production_release` blocks **releasing** a WO while the product's in-house first article (made on another WO) is still open. | Quality → Production gate. |
| **Quality rule 8 (dispatch)** | Not in Production. Finished goods leave through a Store Material Issue of type `dispatch` against an ERP machine; `quality/services/dispatch.py` blocks it without an accepted final lot for the batch, and without an accepted customer / third-party inspection call when the machine's `third_party_inspection_required` is set. | Store calls Quality. |
| **Production → Service (RRV Completion / Handover)** | RRV Completion creates or fills the ERP machine (`erp_projects`); Handover sets it `active` with handover, delivery, commissioning and warranty dates. Service users get a bell. | Production writes `erp_projects`. |
| **Engineering BOM → Production** | **Not built.** The production BOM is entered by hand in BOM & Routing. | Planned (§17 change 3). |
| **Sales → Production** | **Not built.** A build stores customer name and PO as text. | Planned. |
| **Production/Sales → Finance (AR)** | **Not built.** No invoice at handover. | Planned (P3). |
| **Electrical** | The Electrical Integration stage reads the Electrical jobs of the build's machine (`erp_project_id`): all must be `handed_over` or `closed`. | Read only. |
| **Hydraulic** | The Hydraulic & Pneumatic Integration stage reads the Hydraulic systems of the machine: each needs a completed test with result `pass` or `conditional`. | Read only. |
| **Design** | FAI reads the product's released drawing revisions (Design register) to decide "new revision". | Read only, via Quality. |
| **Maintenance** | Maintenance sets a linked workstation to `under_maintenance` while the plant asset is down. Production's `ensure_workstation_available` then blocks starting an operation (or booking the first time on it) there. | Maintenance writes `production_workstations.status`. |
| **Project Management** | The Project Work tab shows department milestones and tasks (shared component). No PM logic; PM stays standalone (decision D2). | Display only. |
| **Organization** | `branches` (shown as Plant) and `departments` on workstations, work orders and builds. Not used for filtering yet. | Read only. |
| **Managed documents** | The handover certificate is a Word document of record (`entity_type = "production_rrv_handover"`), SharePoint folder `Production-Handover/<build number>`. | Write. |

---

# 3. Roles and access

The router-level dependency on every Production route is `require_app_access("production")`. Fine-grained rights come from the Permission Matrix (`core/permission_registry.py`, `MODULES["production"]`).

**Important nuance (`core/permissions.py`):** `require_tab_access` and `require_tab_action` only restrict a user who has **some** Permission Matrix grant in the Production module. A user the matrix has never touched for Production passes every tab and action check. So "has the production app" = full rights until an admin configures the matrix for that user.

## 3.1 Subtabs and which routes check them

| Subtab key | Nav label | View check (`require_tab_access`) | Action checks (`require_tab_action`) |
|---|---|---|---|
| `dashboard` | Dashboard | `GET /production/dashboard` | — |
| `project_work` | Project Work | PM component | — |
| `rrv_builds` | RRV Builds | `GET /rrv-builds`, `GET /rrv-builds/rework` | `create` (new build), `edit` (everything on a build: details, hold/resume, stages, WO link, tests, rework, final inspection request, Word certificate), `delete` (planned build), `approve` (cancel; and **with** the manager rule, RRV Completion and Handover), `print` (certificate PDF) |
| `work_orders` | Work Orders | `GET /work-orders` | `create`, `edit` (edit details, issue, return, reserve, receive output), `delete` (draft only), `approve` (**release**, complete, close, cancel), `print` (job card) |
| `shop_floor` | Shop Floor | `GET /shop-floor/queue` | `edit` (start/complete operation, request inspection, book time), `delete` (delete a time log) |
| `planning` | Planning | `GET /planning` | — |
| `bom` | BOM & Routing | `GET /boms` | `create` (new BOM, new version), `edit` (draft), `delete` (draft), `approve` (activate, obsolete) |
| `workstations` | Workstations | `GET /workstations` | `create`, `edit`, `delete` |
| `reports` | Production Reports | `GET /reports` | — |

Routes with **app access only** (no tab check): `GET` of a single BOM, work order, build, costing, stock movements, material consumption, time-log list, and all `/production/lookups/*`. `GET /production/integrations/projects/{id}/work-orders` accepts the `production` **or** `erp` app.

## 3.2 Typical roles

| Role | Typical person | Rights needed |
|---|---|---|
| **Production planner** | PPC | `bom` create/edit, `work_orders` create/edit, `planning` view |
| **Production manager** | Production head | Everything, plus `bom:approve` and `work_orders:approve` (release). `User.is_production_manager` (set in Users) lets them sign off any RRV build. |
| **Supervisor** | Shift / bay in-charge | `work_orders` view/edit, `shop_floor` edit. Gets bells for release and gate results on WOs where they are supervisor. |
| **Operator** | Fitter, welder | `shop_floor` edit (time booking). `operator_id` defaults to the logged-in user. |
| **Build manager** | Owner of one RRV | `rrv_builds` edit; with `approve` they can sign off **their own** build (`build_manager_id`). |
| **Store** | Store keeper | Store app only; sees and can cancel WO reservations on Store → Reservations. |

**Sign-off rule** (`rrv_can_sign_off`): admin, or `is_production_manager`, or the build's `build_manager_id`. Completing RRV Completion or Handover needs this **and** `rrv_builds:approve`. Cancelling a build needs both. Reopening a stage and cancelling a rework order need the sign-off rule only (they check `rrv_builds:edit` at the route).

> **ERP standard: why release is an approval, not an edit.**
> Releasing a work order commits resources: it reserves stock that another order could have used and puts work on the shop-floor queue. In SAP that's a separate status (REL) and usually a separate authorization from creating the order (CRTD). Here release needs `work_orders:approve`, while creating and editing a draft needs only `create` / `edit`, so a planner can prepare orders and the production manager decides what actually goes to the floor.

---

# 4. Data model

All tables use `TimestampMixin`; BOMs, work orders, workstations, builds, tests and rework orders also use `SoftDeleteMixin`. Statuses are coded tuples in the model files (no-metadata-customization rule).

Migrations: `b7d2e4f6a8c1_add_production_module`, `c5d7e9f1a3b6_add_reservation_to_work_order_materials`, `f1b3d5e7a9c2_add_production_rrv_builds`, `4f7b2c9e1d58_quality_phase2_production_dispatch` (adds `quality_lot_id`).

## 4.1 BOM & routing — `production_boms` (`BOM-YYYY-NNNN`)

| Column | Notes |
|---|---|
| `bom_number`, `product_item_id` | The product is a Store item (must be `active`). |
| `version` | 1, 2, 3… per product (max + 1, across all statuses). |
| `base_quantity` | Component quantities are per this many units (usually 1). |
| `status` | `draft` → `active` → `obsolete`. Only a draft can be edited or deleted. At most one active version per product: activating a version makes the previous active one obsolete. |
| `description`, `remarks`, `created_by_id`, `activated_by_id`, `activated_at` | |

- **`production_bom_items`**: `component_item_id` (Store item, active, not the product itself, no duplicates), `quantity`, `scrap_percent`, `remarks`, `sort_order`.
- **`production_bom_operations`** (routing): `sequence` (unique), `operation_name`, `workstation_id`, `setup_hours`, `run_hours_per_unit`, `requires_inspection` (quality gate), `instructions`.

**Standard cost** (computed on read, `service.bom_standard_cost`, shown on the BOM as `standard_material_cost` and `standard_labour_cost` for `base_quantity` units):
- Material = Σ quantity × (1 + scrap %) × item unit cost.
- Labour = Σ (setup + run per unit × base qty) × workstation `hourly_rate`.
- Item unit cost = `standard_cost`, else `moving_average_cost`, else 0 (`item_unit_cost`).

> **ERP standard: why versions instead of editing.**
> A work order is built against a specific BOM. If someone edits that BOM after release, the order's pick list and the BOM no longer match, and nobody can say what the unit was supposed to contain. So an active BOM is frozen; a change is a **new version** (copied from the source as a draft, one open draft per product). Work orders don't even point at live BOM lines: they **snapshot** them at creation (§4.3), so a later version never changes a running order. This is SAP's "BOM explosion at order creation" behaviour.

## 4.2 `production_workstations`

| Column | Notes |
|---|---|
| `code` (unique), `name` | |
| `workstation_type` | `machine`, `work_center`, `assembly_bay`, `test_bench`, `paint_booth`, `other` |
| `branch_id` (Plant), `department_id` | |
| `capacity_hours_per_day` | Default 8. Used by planning load and report utilisation. |
| `hourly_rate` | Converts logged hours into labour/machine cost. |
| `status` | `active`, `under_maintenance` (set by Maintenance), `inactive`. Only `active` can run operations. |

Deleting is a soft delete and is refused while any released / in-progress work order still has an open operation on it.

## 4.3 Work orders — `production_work_orders` (`WO-YYYY-NNNN`)

| Column | Notes |
|---|---|
| `wo_number`, `product_item_id`, `bom_id` | Raised only from an **active** BOM whose product and components are all active. |
| `erp_project_id` | The machine (ERP) it builds for. Inherited from the RRV build when linked. |
| `branch_id`, `priority` | Priority: `low`, `normal`, `high`, `urgent`. |
| `quantity_planned` | Locked once released. |
| `quantity_completed`, `quantity_scrapped` | Completed = finished goods received; scrapped = sum of time-log scrap. |
| `status` | See §5.1. |
| `source_location_id`, `target_location_id` | Issue-from and receive-into Store locations; both required to release. |
| `planned_start_date`, `planned_end_date`, `actual_start_at`, `actual_end_at`, `closed_at` | Actual start is stamped by the first shop-floor activity. |
| `supervisor_id`, `created_by_id`, `cancel_reason`, `remarks` | |
| `rrv_build_id`, `build_role` | `main` (final vehicle assembly, one per build) or `sub_assembly`. |

Child tables (snapshotted from the BOM by `explode_bom`):
- **`production_work_order_materials`**: `item_id`, `required_qty` = BOM qty × (planned ÷ base) × (1 + scrap %), `issued_qty`, `returned_qty`, `reservation_id` (→ `store_stock_reservations`). A line with `required_qty = 0` is an extra issue of an item not on the BOM.
- **`production_work_order_operations`**: `sequence`, `operation_name`, `workstation_id`, `planned_hours` = setup + run × qty, `requires_inspection`, `status` (`pending`, `in_progress`, `completed`), `qty_good`, `qty_scrap`, `started_at`, `completed_at`, `quality_lot_id` (Phase 2 gate lot), `quality_inspection_id` (legacy gate, still honoured), `instructions`, `remarks`.
- **`production_time_logs`**: `work_order_id`, `operation_id`, `workstation_id`, `operator_id`, `log_date` (not future), `hours`, `qty_good`, `qty_scrap`, `remarks`, `created_by_id`.

## 4.4 RRV builds — `production_rrv_builds` (`RRV-YYYY-NNNN`)

| Group | Columns |
|---|---|
| Order | `rrv_model` (required), `customer_name`, `customer_po_number`, `customer_po_date`, `order_reference` (all text; no Sales link yet) |
| Machine | `erp_project_id` (optional until completion; one machine = one live build), `vehicle_serial_number`, `chassis_number`, `engine_number`, `year_of_manufacture` |
| Control | `branch_id`, `build_manager_id` (defaults to creator), `priority`, `status`, `planned_start_date`, `target_completion_date`, `target_handover_date`, `actual_start_at`, `completed_at`, `completed_by_id` |
| Verify | `required_tests` (JSON list; default 7 tests, §6.6), `final_inspection_id` (→ `quality_inspections`) |
| Handover | `handover_date` (not future), `commissioning_date`, `handed_over_to_name`, `handed_over_to_organization`, `handover_location`, `customer_acceptance_ref`, `warranty_months` (default 12), `handover_remarks`, `handed_over_at`, `handed_over_by_id` |
| Other | `hold_reason`, `cancel_reason`, `remarks`, `created_by_id` |

Child tables:
- **`production_rrv_build_stages`**: one row per catalog stage (unique build + key): `status` (`not_started`, `in_progress`, `completed`, `not_applicable`), `assignee_id`, planned dates, `started_at`, `completed_at`, `completed_by_id`, `remarks`.
- **`production_rrv_tests`**: `test_type`, `test_date`, `result` (`pass`/`fail`), `expected`, `observed`, `remarks`, `tested_by_id`, `witnessed_by` (e.g. customer, RDSO), `retest_of_id`.
- **`production_rework_orders`** (`RW-YYYY-NNNN`): `build_id` (**required** — rework exists only for builds), `source` (`test`, `final_inspection`, `operation_inspection`, `internal`), `source_test_id`, `quality_inspection_id`, `work_order_id`, `quality_ncr_id`, `title`, `defect_description`, `root_cause`, `corrective_action`, `assigned_to_id`, `due_date`, `status`, `hours_spent`, started/done/verified stamps, `verification_remarks`, `cancel_reason`.
- **`production_rrv_events`**: append-only timeline (`action`, `comment`, `actor_id`, `created_at`).

## 4.5 Number series

`BOM-YYYY-NNNN`, `WO-YYYY-NNNN`, `RRV-YYYY-NNNN`, `RW-YYYY-NNNN`, restarting each calendar year. Each takes a transaction-scoped Postgres advisory lock on its prefix (`_lock_number_series`), so concurrent saves can't collide.

---

# 5. Status machines

## 5.1 Work order

```text
          release (approve)        first issue / op start / time log      complete (approve)       close (approve)
  draft ───────────────────▶ released ───────────────────────▶ in_progress ─────────────▶ completed ─────────▶ closed
    │  delete (draft only)       │                                  │
    └────────────────────────────┴──────────────────────────────────┴──▶ cancelled (reason; nothing issued, nothing received)
```

| Action | Endpoint | From | Permission | Rules |
|---|---|---|---|---|
| Edit | `PATCH /{id}` | draft, released, in_progress | `edit` | Quantity changes only in draft (re-explodes the BOM). Changing the source location of a running WO moves its reservations. |
| Release | `POST /{id}/release` | draft | `approve` | Both store locations set; has operations; **FAI check** (§6.3); reserves material; bell to supervisor. |
| Reserve again | `POST /{id}/reserve-materials` | released, in_progress | `edit` | Tops up reservations that were short at release (e.g. after a GRN). |
| Issue | `POST /{id}/issue-materials` | released, in_progress | `edit` | Draws the WO's own reservation first, then posts `issue`. Unknown items become extra lines. Moves the WO to in_progress. |
| Return | `POST /{id}/return-materials` | released, in_progress, completed | `edit` | Can't return more than issued − returned. Posts `return_in`. |
| Receive output | `POST /{id}/receive-output` | in_progress | `edit` | Not more than planned − completed. Every gated operation must have an accepted gate. Serial-controlled products: whole units, serial in the batch field. Final-inspected products go to a Quality final lot (§6.4). |
| Complete | `POST /{id}/complete` | in_progress | `approve` | Every operation completed and quantity_completed > 0. Releases remaining reservations; bell to creator. |
| Close | `POST /{id}/close` | completed | `approve` | Stamps `closed_at`. No settlement yet. |
| Cancel | `POST /{id}/cancel` | draft, released, in_progress | `approve` | Reason required. Refused while material is still issued (return it first) or any output was received. Releases reservations. |

Operation statuses: `pending` → `in_progress` → `completed`. Start (`/operations/{op}/start`) checks the workstation is active and that no earlier gate is undecided or rejected. Complete (`/operations/{op}/complete`) checks the operation's own gate passed.

## 5.2 RRV build

`planned → in_progress → completed → handed_over`, plus `on_hold` (reason; resume returns to in_progress or planned) and `cancelled` (reason; only from planned / in_progress / on_hold; refused while any linked WO is released or in progress). The build moves to in_progress on the first stage start or completion. Delete only while planned, with no linked WOs and no test records.

A **completed** build can still record tests and edit handover fields; identity fields are frozen ("Reopen RRV Completion to correct the vehicle's identity"). A **handed-over** or **cancelled** build is closed.

## 5.3 Stage

`not_started → in_progress → completed`, or `not_applicable` (reason; only stages that allow N/A). **Reopen** (reason) is allowed only to the sign-off group, only if no later stage is done ("Reopen those first, latest first"), and never after handover. Reopening RRV Completion sets the build back to in_progress.

## 5.4 Rework order

```text
open ──start──▶ in_progress ──done (corrective action, hours)──▶ done ──verify (different person + passing re-check)──▶ verified
  │                  ▲                                             │
  │                  └──────────── reject verification (reason) ───┘
  └──────── cancel (reason; sign-off group only) from open / in_progress / done
```

---

# 6. Workflows

## 6.1 BOM lifecycle

1. **New BOM** (draft, version = next number for the product). Add components and routing.
2. **Activate** (`bom:approve`): needs at least one component; re-validates that all components and workstations still exist and are active; makes the previous active version obsolete.
3. **New version** (`bom:create`): copies any version into a new draft. Refused if the product already has an open draft.
4. **Obsolete** (`approve`): an active BOM can be retired without a replacement.

## 6.2 Work order: create → release

- Create from an active BOM; materials and operations are snapshotted. Optional `rrv_build_id` + `build_role` (default `sub_assembly`) link it to a build (§6.6).
- Release needs both store locations and at least one operation, passes the FAI check, then reserves material.

**Reservation** (`service.reserve_materials`): for each line, the outstanding quantity (required − (issued − returned)) minus what is already held is reserved at the source location, up to the free quantity (on hand − reserved). A partly reserved line is reported but doesn't block release; use **Reserve again** later. Each reservation is a `store_stock_reservations` row (`production_order = WO number`, remarks "Held for Production work order …"). Store users can cancel it, so its own status is the truth. Issue draws down the reservation first (`consume_reservation`); complete and cancel release whatever is left.

> **ERP standard: why reserve at release.**
> Without a reservation, two released orders both see "10 in stock" and both plan to use them. A reservation says "these 10 are promised to WO-2026-0031", so the second order sees the real free quantity, and Store knows not to issue them elsewhere. SAP creates reservations when the order is created and makes them "relevant for MRP" at release; this portal reserves only at release, so drafts never lock stock.

## 6.3 FAI release check (Quality rule 9)

`quality/services/first_article.check_production_release` runs on release. It applies only to products that get a final inspection (`needs_inspection_on_receipt(item, "final")`). If an in-house first article for the product is **open** and came from a **different** WO, the release is refused (409) with the FAI number: "Finish and approve the FAI in Quality → First Article before releasing more production." The WO that makes the first article itself can be released. The FAI is created automatically at Receive Output when the product is a new item, has a new released drawing revision, or has no approved FAI and no accepted history (§6.4).

> **ERP standard: FAI (First Article Inspection).**
> The first unit made from a new drawing, a new revision or a new source gets a full drawing check (every dimension, note and material), not the usual sampling. Until that first article is approved, nobody knows whether the drawing, the tooling and the process together produce a good part, so making a batch is a gamble. That's why the gate sits at **release** of the next order (don't commit more material and hours) and at the **usage decision** of regular lots. AS9102 is the aerospace form of this; the idea is the same for RRVs.

## 6.4 Shop floor, quality gates and finished-goods receipt

1. **Start operation**: workstation must be `active` (Maintenance can block it) and no earlier gated operation may be undecided or rejected (`production_gates.start_problem`).
2. **Book time** (`POST /time-logs`): hours, good qty, scrap qty, operator, date (not future). A pending operation becomes in_progress; the first booking also checks the workstation. Scrap adds to `wo.quantity_scrapped`. Time logs are locked once the operation or WO is completed.
3. **Request inspection** on a gated step: creates an in-process **lot** in Quality (`inspection_type = "in_process"`, `source_type = "work_order_operation"`, quantity = good qty so far or the planned qty, batch = WO number). The gate statuses shown in Production map from the lot: created → pending; in inspection / results recorded → in_progress; accept → passed; accept with deviation / partial → conditionally passed; reject / cancelled → failed. A failed gate can be requested again after rework.
4. **Complete operation**: a gated step needs a passed / conditionally passed gate.
5. **Receive output**: refused while any gated step lacks an accepted gate. Then:
   - If the product is final-inspected: `create_lot_for_production_output` puts the quantity into **Quality stock** under a final lot (or a first-article lot when FAI applies). Quality's usage decision releases it to Free stock or blocks it with an NCR.
   - Otherwise: a plain `receipt` into the target location.
   - Batch = the serial given, else the WO number. **That batch is what dispatch must name later.**

Legacy gates (`quality_inspection_id`, free-text inspections raised before Phase 2) are still honoured until re-requested.

> **ERP standard: backflush vs manual issue.**
> **Manual issue** (what this portal does): Store physically issues components against the WO, and the ledger moves when they leave the shelf. Consumption is exact, and the issue slip is the audit trail. **Backflush**: nothing is issued during the job; when output is confirmed, the system deducts BOM qty × output automatically. It saves clerical work for cheap, high-volume items (bolts, consumables) but stock is only right if the BOM is right and scrap is reported. For one-at-a-time RRV builds with expensive components, manual issue is the correct default. §42 lists "Backflush consumption: off" as a setting; it isn't built.

## 6.5 Planning and reports

- **Planning** (`GET /production/planning?include_draft=`): (a) material requirements: outstanding demand of open WOs netted against each line's own reservation and free stock across **all** locations, biggest shortage first, with `make_bom_id` when the item has its own active BOM (build it, don't buy it); (b) workstation load: remaining planned hours ÷ capacity per day = load days; (c) schedule with progress and overdue flag. One level only, not time-phased (see next-phase-plan Topic 1).
- **Costing** (`GET /work-orders/{id}/costing`): estimated (required qty × unit cost + planned hours × rate) vs actual (issued − returned × unit cost + logged hours × rate), variance and cost per unit. Computed on read from **current** item costs and rates; never stored.
- **Reports** (`GET /production/reports?date_from&date_to`, max 366 days, default last 30): finished-goods output from the ledger, estimated vs actual cost of WOs finished in the range, workstation utilisation (hours ÷ capacity × Mon–Sat days), scrap rate.
- **Dashboard**: WO counts, overdue, 30-day output / scrap / hours, pending inspections (legacy + open gate lots), shortage items, active BOMs and workstations, recent and due-in-7-days orders.
- **Job card** (`GET /work-orders/{id}/job-card`, `work_orders:print`): A4 PDF traveller with pick list and routing.

## 6.6 RRV build

**Stage catalog** (`PRODUCTION_RRV_STAGES`; gates in `service.rrv_stage_gate_problems`, which returns every blocking reason as a sentence):

| # | Key | Stage | Gate | N/A |
|---|---|---|---|---|
| 1 | `planning` | Production Planning | Target completion and handover dates set; a main WO linked | – |
| 2 | `material_kitting` | Material Kitting & Issue | At least one linked WO; none in draft; no open WO with a line not fully issued | – |
| 3 | `sub_assembly` | Sub-Assemblies | At least one sub-assembly WO; all completed / closed | ✓ |
| 4 | `main_assembly` | Chassis & Main Assembly | Main WO in progress or done; Sub-Assemblies done | – |
| 5 | `electrical_integration` | Electrical Integration | Machine linked; at least one Electrical job for it; all handed over / closed | ✓ |
| 6 | `hydraulic_integration` | Hydraulic & Pneumatic Integration | Machine linked; at least one Hydraulic system; each has a latest completed test with `pass` / `conditional` | ✓ |
| 7 | `final_assembly` | Final Assembly | Main WO completed / closed; stages 4–6 done | – |
| 8 | `final_inspection` | Final Quality Inspection | The build's final inspection is passed / conditionally passed | – |
| 9 | `testing` | Vehicle Testing | At least one required test; the latest record of each is a pass | – |
| 10 | `rework_closure` | Rework & Punch-list Closure | No rework order open, in progress or done-awaiting-verification | – |
| 11 | `rrv_completion` | RRV Completion | Stages 1–10 done; serial (or linked machine) and chassis number entered. **Sign-off.** | – |
| 12 | `handover` | Production Handover | Completion done; handover date, recipient and location entered. **Sign-off.** | – |

Stages are not forced in order except through these gates; any not-started stage can be started.

**Work orders on a build**: raise from the build (pre-linked) or link an existing WO (`POST /{id}/work-orders/{wo_id}` with `build_role`). Rules (`check_rrv_link`): build planned or in progress; WO not cancelled and not on another build; same machine as the build; one live `main` WO per build. Unlinking is refused once the build is completed. **Material consumption** (`GET /{id}/material-consumption`) rolls up required / issued / returned / outstanding / consumed and value across all linked, non-cancelled WOs.

**Final inspection**: `POST /{id}/request-final-inspection` (after Final Assembly is done) creates a `quality_inspections` row (type `final`, number prefix `FIN`, batch = build number) and bells every Quality user. A new one can be requested only after the previous one failed.

**Vehicle tests**: 13 types (static inspection, rail gauge check, guide-wheel deployment, brake tests road and rail, road trial, rail trial, load test, emergency stop, lighting & signalling, hydraulic functions, electrical functions, other). Default required: static inspection, guide-wheel deployment, both brake tests, road trial, rail trial, emergency stop. A fail needs `observed` or `remarks` and **automatically raises a rework order**. A retest must point at an earlier test of the same type. Tests are locked once the Testing stage is done; a failed test with a rework order can't be deleted.

**Rework verification** (`rework_verification_problem`): the verifier can't be the person who marked it done, and the failed check must pass again: a later passing test of the same type (source `test`); for a Phase 2 gate failure, every gate on the WO accepted again; for a legacy / final inspection, a newer inspection with the same batch and label that passed.

**RRV Completion** (`register_rrv_machine`): if no machine is linked, creates an `erp_projects` row (serial = vehicle serial; 409 if the serial already exists — link that machine instead), machine type `RRV`, status `manufacturing_under_progress`, and links the build's WOs to it. Fills model, client, chassis, engine, year (default this year), PO number and date where blank. Build → `completed`. Bell `production_rrv_completed`.

**Handover** (`apply_rrv_handover`): machine `status = active`, `delivery_date = handover_date = build.handover_date`, `commissioning_date` (if given), **`warranty_start_date = handover_date`**, `warranty_end_date = handover + warranty_months` (month-end clamped), site location if blank. Build → `handed_over`. Bells to the build manager and creator, and a broadcast to every Service (`erp`) user: "New machine in service".

> **ERP standard: warranty start.**
> Warranty can start at dispatch, at delivery/handover, or at commissioning. Starting at **commissioning** is fairest to the customer (the clock doesn't run while the vehicle waits at site for installation) and is common for capital equipment; starting at **handover** is simpler to prove (you hold the signed handover). The code starts it at **handover**. `MODULE_DETAILED_PLAN.md` §44 lists the setting as "starts from commissioning" by default. Decide one and apply it consistently: the contract's warranty clause wins.

**Handover certificate**: once handed over, `GET /{id}/handover-certificate` (`rrv_builds:print`) returns the PDF **of record**: if a Word document exists, its PDF (with any Word edits) is returned, else a fresh render. The Handover tab's `ManagedDocumentPanel` uses the generic `/managed-documents/production_rrv_handover/{build_id}` routes (create, edit in Word Online, changes, download .docx, upload) gated by `rrv_builds:edit` to modify and `print` to read. Single revision (0), because handover facts are fixed at handover.

---

# 7. Notifications

All through `notify_user` / `broadcast_notification`. **No Production notification uses Teams** (`teams=True` is reserved for approvals and reminders; Production has neither yet). Types ending in `_created`, `_updated`, `_deleted` are suppressed app-wide.

| `notification_type` | Recipients | When | Channel |
|---|---|---|---|
| `work_order_released` | WO supervisor (not the actor) | Release | Bell |
| `work_order_completed` | WO creator | Complete | Bell |
| `production_inspection_result` | WO supervisor and creator | Gate lot decided (or legacy inspection result) | Bell |
| `production_inspection_requested` | All Quality-app users | Final vehicle inspection requested | Bell |
| `production_rrv_inspection_passed` | Build manager and creator | Final inspection passed | Bell |
| `production_rework_raised` | Build manager, creator, assignee | Rework raised (auto or manual) | Bell |
| `production_rework_done` | Build manager and creator | Rework marked done | Bell |
| `production_rework_rejected` | Build manager, creator, doer, assignee | Verification rejected | Bell |
| `production_rrv_completed` | Build manager and creator | RRV Completion | Bell |
| `production_rrv_handed_over` | Build manager and creator; broadcast to all `erp` users | Handover | Bell |

There are no scheduled jobs or reminders in Production (no overdue-WO or overdue-build reminder).

---

# 8. API endpoints

All under `/api/v1`, tag `Production`, router dependency `require_app_access("production")`.

**BOMs** `/production/boms`
| Method and path | Permission |
|---|---|
| `GET ?status&product_item_id&search` | `bom` view |
| `POST` | `bom:create` |
| `GET /{id}` (with standard cost) | app |
| `PATCH /{id}` (draft) | `bom:edit` |
| `POST /{id}/activate`, `/obsolete` | `bom:approve` |
| `POST /{id}/new-version` | `bom:create` |
| `DELETE /{id}` (draft) | `bom:delete` |

**Workstations** `/production/workstations`: `GET` (`workstations` view), `POST` (`create`), `GET /{id}` (app), `PATCH /{id}` (`edit`), `DELETE /{id}` (`delete`).

**Work orders** `/production/work-orders`
| Method and path | Permission |
|---|---|
| `GET ?status&priority&erp_project_id&product_item_id&overdue&search` | `work_orders` view |
| `POST` (optional `rrv_build_id`, `build_role`) | `work_orders:create` |
| `GET /{id}`, `GET /{id}/costing`, `GET /{id}/stock-movements` | app |
| `PATCH /{id}` | `edit` |
| `DELETE /{id}` (draft) | `delete` |
| `POST /{id}/release`, `/complete`, `/close`, `/cancel` | `approve` |
| `POST /{id}/issue-materials`, `/reserve-materials`, `/return-materials`, `/receive-output` | `edit` |
| `GET /{id}/job-card` | `work_orders:print` |
| `POST /{id}/operations/{op}/start`, `/complete`, `/request-inspection` | `shop_floor:edit` |

**Shop floor** `/production`
| Method and path | Permission |
|---|---|
| `GET /shop-floor/queue?workstation_id&include_pending` | `shop_floor` view |
| `GET /time-logs?work_order_id&workstation_id&operator_id&date_from&date_to` (500 max) | app |
| `POST /time-logs` | `shop_floor:edit` |
| `DELETE /time-logs/{id}` | `shop_floor:delete` |

**Planning, reports, dashboard, lookups, integrations**
| Method and path | Permission |
|---|---|
| `GET /production/planning?include_draft` | `planning` view |
| `GET /production/reports?date_from&date_to` | `reports` view |
| `GET /production/dashboard` | `dashboard` view |
| `GET /production/lookups/items`, `/locations`, `/projects`, `/branches`, `/departments`, `/users`, `/workstations`, `/active-boms` | app |
| `GET /production/integrations/projects/{project_id}/work-orders` | `production` or `erp` app |

**RRV builds** `/production/rrv-builds`
| Method and path | Permission |
|---|---|
| `GET ?status&search&overdue` | `rrv_builds` view |
| `GET /rework?…&mine` | `rrv_builds` view |
| `POST` | `rrv_builds:create` |
| `GET /{id}` (includes `allowed_actions`), `GET /{id}/material-consumption` | app |
| `PATCH /{id}`, `POST /{id}/hold`, `/resume` | `edit` |
| `POST /{id}/cancel` | `approve` + sign-off rule |
| `DELETE /{id}` | `delete` |
| `POST /{id}/work-orders/{wo_id}`, `DELETE /{id}/work-orders/{wo_id}` | `edit` |
| `PATCH /{id}/stages/{key}`, `POST …/start`, `…/complete`, `…/not-applicable`, `…/reopen` | `edit` (complete of the two sign-off stages: + `approve` + sign-off rule; reopen: + sign-off rule) |
| `POST /{id}/request-final-inspection` | `edit` |
| `POST /{id}/tests`, `DELETE /{id}/tests/{test_id}` (recorder or admin) | `edit` |
| `POST /{id}/rework`, `POST /rework/{rid}/start`, `/done`, `/verify`, `/reject-verification` | `edit` |
| `POST /rework/{rid}/cancel` | `edit` + sign-off rule |
| `GET /{id}/handover-certificate` | `rrv_builds:print` |
| `/managed-documents/production_rrv_handover/{id}[/changes\|/edit\|/docx\|/upload]` | `production` app + `rrv_builds` print (read) / edit (modify) |

---

# 9. Frontend pages

| Route | Page |
|---|---|
| `/dashboard/production` | Dashboard |
| `/dashboard/production/project-work` | PM milestones and tasks for the department |
| `/dashboard/production/rrv-builds`, `/new`, `/[id]` | Build list (status tabs, progress x/12, current stage, overdue), new build, detail with Stages, Work Orders & Material, Tests, Rework, Handover (details + Word certificate panel), Timeline. Buttons follow the server's `allowed_actions`. |
| `/dashboard/production/rrv-builds/rework` | Every rework order across builds |
| `/dashboard/production/work-orders`, `/new`, `/[id]` | List, create (accepts `?rrv_build_id=&build_role=`), detail with materials, operations and gates, stock movements, costing, job card |
| `/dashboard/production/shop-floor` | Operation queue and time booking |
| `/dashboard/production/planning` | Requirements (Build / Raise PR), workstation load, schedule |
| `/dashboard/production/bom`, `/new`, `/[id]` | BOM & routing with versions and standard cost |
| `/dashboard/production/workstations`, `/new`, `/[id]` | Workstations |
| `/dashboard/production/reports` | Output, cost variance, utilisation, scrap |

Shared components: `frontend/src/components/production/` (`ProductionNav`, `BomForm`, `WorkstationForm`, `rrvMeta.ts`) and `components/shared/ManagedDocumentPanel`. App-wide rules apply: nav above the header, "← Back" pill top-right, `ConfirmDialog` / `PromptDialog` for reasons, real backend error messages.

---

# 10. Known gaps

1. **Booking time can bypass the gate hold.** `POST /time-logs` on a pending operation moves it to in_progress after only the workstation check. It does not call `production_gates.start_problem`, so an operator can effectively start the next operation while an earlier gate is undecided by booking time instead of pressing Start.
2. **The RRV final inspection is still a legacy free-text inspection** (`quality_inspections`, `FIN-`), not a Phase 2 final inspection lot with plan, sampling and usage decision. Rework verification matches the re-inspection on batch number + label text.
3. **Handover doesn't check dispatch.** Rule 8 (final lot accepted, third-party inspection certificate) is enforced only on a Store `dispatch` issue. An RRV can be handed over with no dispatch issue and no inspection call, and the handover stage doesn't look at either.
4. **Costing uses today's cost.** Actual cost = consumed qty × current standard (else moving average) and hours × current hourly rate. Finished goods are received with no value; there is no settlement at close. Nothing writes `moving_average_cost` yet. See next-phase-plan Topic 2.
5. **Scrap has no reason, no stock movement and no value.** Rework exists only on RRV builds (`build_id` is required).
6. **Planning is single-level and not time-phased**; ignores open POs, Quality stock and lead times. Capacity ignores holidays; reports assume Mon–Sat.
7. **No plant scoping**: every Production user sees every plant.
8. **No Engineering BOM → Production BOM** feed, no Sales Order → build link, no AR invoice at handover.
9. **Required tests are per build, not per RRV model**; there is no test template per model (§42).
10. **Single Hydraulic & Pneumatic stage**: the plan's split into separate Hydraulic and Pneumatic Installation stages (13 stages) isn't built; Electrical gate checks Electrical jobs, not the plan's "package stages 1–5 + signed installation checklist".
11. **No reminders**: overdue WOs, overdue builds and stale rework have no daily reminder (they'd be Teams-eligible reminders).
12. **No labour rate by skill**: labour cost is per workstation `hourly_rate` only.

---

# 11. Related documentation

- [RRV Build design note](rrv-build.md) (30 Sep 2026; superseded where §13 says so)
- [Production next-phase plan](next-phase-plan.md)
- [Store overview](../store/overview.md): ledger, reservations, dispatch issue
- [Service & Commissioning overview](../service-commissioning/overview.md): the machine registry Handover writes into
- [Maintenance overview](../maintenance/overview.md): workstation status sync
- `docs/MODULE_DETAILED_PLAN.md` §17, §24, §42

---

# 12. Decision history (from git)

| Commit | Date | Decision |
|---|---|---|
| `f06d120` | Sep 2026 | RRV Production added with Design, Electrical, Hydraulic, Maintenance, HR |
| `20d441d`, `19d537d` | 30 Sep – 1 Oct 2026 | Notifications: no create/update/delete alerts; Teams only for approvals and reminders |
| `4d159a5`, `eed23fa`, `6f811c0` | Oct 2026 | Production was one of 9 modules locked to an email allow-list (`core/module_visibility.py`); that file is deleted in the current working tree, so check whether the lock is still meant to apply |
| `aa9b49f` | 6 Oct 2026 | Quality Phase 2: in-process gate lots, FAI, final lot on receipt, dispatch block, Word handover certificate |

---

# 13. Where rrv-build.md is out of date

| rrv-build.md says | Code now |
|---|---|
| "a Quality gate per operation" raises an inspection | Gate = in-process inspection **lot** with usage decision; legacy inspections still honoured |
| Handover issues a printable Handover Certificate **PDF** | Managed **Word** document of record; the PDF endpoint returns the Word version's PDF once one exists |
| Rework auto-raised when "a linked WO's operation inspection fails" | Also from a **rejected gate lot**, linked to the lot's NCR |
| §3 "Completing RRV Completion or Handover needs approve + manager" | Still true; additionally **cancel build** needs approve + manager, and **reopen stage** / **cancel rework** need the manager rule |
| Not mentioned | FAI release check on WO release; final-inspected products go to a Quality final lot at Receive Output |
