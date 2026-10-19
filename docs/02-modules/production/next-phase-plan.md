# Production Module — Next Phase Plan

**Module:** Production (`production`)
**Backend Location:** `backend/app/modules/production/` (exists)
**Frontend Location:** `frontend/src/app/dashboard/production/` (exists)
**Spec:** `docs/MODULE_DETAILED_PLAN.md` §17 (Production incl. RRV Build), §42 (Production settings), §0A decisions D5 and D8. Related: [rrv-build.md](rrv-build.md), [Engineering BOM plan](../engineering/plan.md) §4.3, §5.5, §5.6.
**Prepared by:** Vineet Sharma
**Date:** 7 October 2026
**Status:** Draft plan, no code yet. The questions in §13 have recommended defaults, so a phase can start before they are answered. An answer only changes a default.

This plan covers five topics:

1. Multi-level MRP
2. Finished-goods receipt valuation and work-order settlement (management costing only, because of decision D5)
3. Scrap with reason codes, and rework orders for ordinary work orders
4. Capacity planning with a working calendar and finite scheduling
5. Plant (branch) data scoping

---

# 1. Purpose

The Production module can already build things. It has versioned BOMs with routing, work orders with reservations, issues and returns, shop-floor time booking, quality gates, finished-goods receipt and RRV builds. It still can't answer five planning and control questions:

1. **"To build what's on the plan, what do I have to make, what do I have to buy, and by when?"** Today's Planning page nets one level only. It ignores open purchase orders and receipts waiting for inspection, and it has no dates.
2. **"What did this work order, or this RRV, actually cost, and why is that different from the estimate?"** Today's costing is recomputed every time the page loads, from the *current* item cost. It has no job work, no scrap and no rework. The finished goods go into stock with no cost at all.
3. **"What did we scrap, why, and what did it cost us?"** Today scrap is a bare number on a time log. It has no reason, no stock movement and no value. Rework exists only inside an RRV build.
4. **"Can the shop actually finish these orders by their dates?"** Today's workstation load is *remaining hours ÷ hours per day*. It knows nothing about Sundays, holidays, dates or the order in which the jobs run.
5. **"Who should see which plant's production?"** Today every Production user sees every plant.

---

# 2. What already exists (checked 7 October 2026)

| Concept | Where | What it does today | Gap this plan closes |
|---|---|---|---|
| BOM explosion | `service.py:54` `explode_bom()` | Takes **one level**: components × (qty ÷ `base_quantity`) × (1 + `scrap_percent`). Routing hours are setup + run × qty. | Topic 1: recursive explosion through sub-assembly BOMs, with low-level codes and loop detection. |
| Material requirements | `service.py:214` `material_requirements()`, `routes/planning.py` | Outstanding demand from open WOs, minus each line's own reservation, minus free stock (on hand − reserved) **summed over all stores**. Sets `make_bom_id` when the item has an active BOM. **Not time-phased.** It ignores open POs, pending GRNs, Quality stock, safety stock and lead times. | Topic 1. |
| Planning page actions | `frontend/.../production/planning/page.tsx:132-139` | **Build** opens a new WO with `bom_id` and the quantity, with no parent link. **Raise PR** sends a **single-line** URL pre-fill for each row. | Topic 1: child WOs linked to their parent, and one multi-line PR. |
| Multi-line PR pre-fill | `frontend/.../p2p/new/page.tsx:69-83` | `?prefill=session` reads `sessionStorage['p2p_new_prefill'] = {items, remarks}`. It is already used by Maintenance → Spares and planned by Engineering §5.6. | Topic 1 reuses it as it is. |
| Item master planning fields | `store/models/item.py:97-103` | `minimum_stock`, `reorder_level`, `safety_stock`, `reorder_quantity`, `standard_cost`, `moving_average_cost`. **There is no lead-time field.** | Topic 1: `lead_time_days`. This is the **same column** Engineering §4.3 plans, so only one session adds it (§4.6). |
| Weighted average cost | `store_items.moving_average_cost` | Read by Production, Maintenance, Quality and the Accounts closing-stock valuation (`accounts/services/inventory.py:46`). **Nothing in the app writes it.** GRN posting (`p2p/routes/goods_receipts.py:119`) does not update it, and `store_stock_transactions` has no cost column. | **Blocking prerequisite for Topic 2** (§11, Phase 0). Without it, "material at weighted average" is whatever someone typed into the item master. |
| WO costing | `service.py:117` `work_order_costing()` | Computed when read and never stored. It uses `item_unit_cost()`, which takes **standard cost first**, then moving average. The "actual" figure is therefore really issued qty × today's standard. Labour is hours × the workstation's **current** `hourly_rate`. | Topic 2: snapshot cost at the moment of each transaction, plus job work, scrap and rework, and a settlement at close. |
| FG receipt | `routes/work_orders.py:567` `receive_output()` | Posts a ledger `receipt` (or a Quality final lot), with no cost. | Topic 2: the receipt carries a provisional unit cost, and settlement corrects it. |
| Scrap | `routes/shop_floor.py:164-170` | A time log carries `qty_scrap`, which is added to `op.qty_scrap` and `wo.quantity_scrapped`. There is no reason, no stock movement and no value. | Topic 3. |
| Rework | `models/rrv_build.py:164` `ProductionReworkOrder` | **`build_id` is NOT NULL**, so rework exists only for RRV builds. It is raised automatically from failed tests and inspections (`service.py:626`). The verifier must not be the doer, and verification needs a passing re-check (`service.py:660`). | Topic 3: make the build optional and allow rework on any WO. |
| Workstation load | `routes/planning.py:20` `_workstation_load()` | Remaining hours ÷ `capacity_hours_per_day` = `load_days`. It has no dates, no calendar and no sequence. | Topic 4. |
| Working days | `routes/reports.py:25` `_working_days()` | Hard-coded Mon–Sat. | Topic 4: the plant calendar. |
| Plant calendar | `hr/services/calendar.py` `CalendarCache`, `parse_working_days()` | Reads `Branch.working_days` (free text such as "Mon-Sat") and the blocking national and festival `HrHoliday` rows for that plant or for all plants. Maintenance already reuses the parser (`maintenance/reporting.py:95`). | Topic 4 reuses it. |
| Plant columns | `ProductionWorkOrder.branch_id`, `ProductionWorkstation.branch_id`, `ProductionRrvBuild.branch_id` | All are nullable and none are filtered on. | Topic 5. |
| Plant access | `store/services/plant_access.py` | Store → Settings → Plant Access. The setting is ON/OFF, with per-user `all_plants` or `branch_ids` overrides, and falls back to `User.branch_id`. Admins are unrestricted. | Topic 5 reuses the resolver. |
| Settings framework | `core/settings_framework.py`, migration `b3d8f1a6c2e9_module_settings.py` (**uncommitted**, current alembic head) | Typed, code-declared settings. A row exists only while an admin overrides the code default. Supports per-plant values. | Every new setting in §9 is declared here. |
| Quality integration | `quality/services/production_gates.py`, `quality/services/lots.py`, `quality/services/ncr.py` | In-process gate lots, FG final lots on receipt, and NCR disposition `scrap` (posts `quarantine_out`). | Topic 3 must not create a second scrap path for the same event (§5.3.4). |

---

# 3. Users and roles

Everything stays under the `production` app key and the existing Permission Matrix subtabs. Two subtabs are added (§7.3).

| Role | Typical person | What they do in this phase |
|---|---|---|
| **Production Planner** | PPC / planning engineer | Runs MRP, maintains the demand plan, converts planned orders into child WOs, raises PRs from shortages, runs and applies the capacity schedule. Needs `planning:create` and `work_orders:create`. |
| **Supervisor / Shift in-charge** | Shop-floor supervisor | Books scrap with a reason, raises rework on their WOs, and sees their plant's schedule. Needs `shop_floor:edit`. |
| **Production Manager** (`User.is_production_manager`) | Production head | Approves scrap above the value limit, closes and settles WOs, verifies rework (never their own), and sees cost reports. Needs `work_orders:approve`. |
| **Management / Accounts** | Partners, accounts | Read-only access to the RRV cost report and the WIP valuation report (`reports:view`, `reports:export`). |
| **Store** | Store keeper | Unchanged. Store users see child-WO reservations and scrap receipts in their own pages. |

---

# 4. Data model

All new tables use `TimestampMixin`. Documents also use `SoftDeleteMixin`. Every model is registered with `register_audited(...)` in `core/audit_registry.py`, with child lines using `parent_attr`. Statuses and categories are **coded tuples in the model file** (D8). Admins maintain **values** (scrap reasons) and **settings**, never structure.

## 4.1 MRP (Topic 1)

### `ProductionDemand` (`production_demands`), number `PD-YYYY-NNNN`

This is a light master production schedule (MPS). It holds the independent demand that has no work order yet.

| Field | Notes |
|---|---|
| `demand_number` | Generated |
| `item_id` | FK `store_items`. Usually the RRV, or a spare sub-assembly to stock. |
| `quantity`, `required_date` | |
| `branch_id` | Plant that will build it |
| `source_type` | `manual`, `rrv_build`, `sales_order` (reserved for later; see §13 Q2) |
| `source_id`, `source_reference` | For example the RRV build id and `RRV-2026-0007`. |
| `status` | `open`, `covered` (a WO now exists for it), `cancelled` |
| `work_order_id` | Set when a planned order for it is converted |
| `remarks`, `created_by_id` | |

### `ProductionMrpRun` (`production_mrp_runs`), number `MRP-YYYY-NNNN`

Each run is saved so its numbers can be explained later ("why does it say buy 4?").

| Field | Notes |
|---|---|
| `run_number`, `run_at`, `run_by_id` | |
| `branch_id` | Null means all plants (see Topic 5 and §13 Q4) |
| `horizon_end`, `bucket` | `day` or `week` (setting) |
| `params` | JSON snapshot of every setting used (include drafts, count open PRs, inspection buffer, default lead days) |
| `status` | `completed`, `failed` (with `error`), `superseded` (a newer run exists for the same plant) |
| `summary` | JSON counts: buy lines, make lines, exceptions |

### `ProductionMrpLine` (`production_mrp_lines`)

There is one row per item per bucket that has activity. It holds the classic MRP record.

| Field | Notes |
|---|---|
| `run_id`, `item_id`, `low_level_code`, `bucket_date` | |
| `gross_requirement` | Dependent demand (WO material lines and exploded planned orders) plus independent demand (`ProductionDemand`) |
| `scheduled_receipts` | Open PO qty, GRN qty not yet in Free stock, and open child WOs due in this bucket |
| `projected_on_hand` | After this bucket |
| `net_requirement` | |
| `planned_order_receipt`, `planned_order_release_date` | Lot-sized quantity, and the release date offset by lead time |
| `action` | `buy`, `make`, `expedite` (supply exists but arrives after the need), `defer` / `cancel` (supply is no longer needed), `none` |
| `lead_time_days`, `lead_time_source` | `item`, `bom_routing`, `bom_override`, `default` (`default` is flagged as an *assumed* lead time) |
| `open_pr_qty` | Shown separately and subtracted from buy suggestions so the same shortage isn't PR'd twice |
| `pegging` | JSON: which demand (WO line, demand row, parent planned order) this need came from |
| `converted_ref` | WO number or PR reference once acted on |

### Changes to `production_work_orders`

| Column | Purpose |
|---|---|
| `parent_work_order_id` (nullable self-FK, indexed) | The child WO for a sub-assembly points to the WO that consumes its output |
| `mrp_run_id` (nullable FK) | The run that suggested it (traceability only) |
| `demand_id` (nullable FK) | The `ProductionDemand` it covers |

The existing `rrv_build_id` / `build_role` stay as they are. A child of an RRV WO inherits the build with role `sub_assembly`.

## 4.2 Costing and settlement (Topic 2)

### `ProductionWorkOrderCharge` (`production_work_order_charges`)

This table holds external costs that are neither Store material nor shop hours.

| Field | Notes |
|---|---|
| `work_order_id` | |
| `charge_type` | Coded: `job_work`, `outside_service`, `testing_fee`, `other` |
| `vendor_name` / `vendor_id` | Points to the existing vendor master |
| `reference_type`, `reference_number` | `store_issue` (the job-work challan issue), `p2p_po`, `vendor_invoice`, `manual` |
| `amount`, `charge_date`, `remarks`, `created_by_id` | |

### `ProductionWorkOrderSettlement` (`production_work_order_settlements`)

There is one row per WO. It is written when the WO is closed and is then frozen, so a WO's cost never drifts after the fact.

| Field | Notes |
|---|---|
| `work_order_id` (unique), `settled_at`, `settled_by_id` | |
| `qty_received`, `qty_scrapped` | |
| `std_material`, `std_labour`, `std_total` | Standard cost from the WO's own snapshotted lines at standard rates (§5.2.1) |
| `act_material`, `act_labour`, `act_job_work`, `act_rework`, `scrap_recovery_credit`, `act_total` | Actual cost (§5.2.2) |
| `provisional_unit_cost` | What the FG receipts were valued at |
| `actual_unit_cost` | `act_total ÷ qty_received` |
| `variance_total`, `variances` | `variances` is JSON: material price, material usage, labour rate, labour efficiency, scrap, rework |
| `fg_revaluation_qty`, `fg_revaluation_amount` | What was applied to the FG item's weighted average (§5.2.4) |
| `lines` | JSON detail for the report |

### Cost snapshot columns on existing tables

| Table | Column | Why |
|---|---|---|
| `store_stock_transactions` | `unit_cost` (nullable) | This is **Store-owned** (Phase 0). On issue, the item's weighted average *at that moment*. On receipt, the GRN rate, or for a WO receipt the provisional unit cost. |
| `production_time_logs` | `hourly_rate` (nullable) | Snapshots the workstation's rate when the log is booked, so a rate change next year doesn't rewrite last year's costs. A null rate falls back to the current rate for old rows. |

## 4.3 Scrap and rework (Topic 3)

### `ProductionScrapReason` (`production_scrap_reasons`), a settings master (values only)

| Field | Notes |
|---|---|
| `code`, `name` | For example `MC-ERR`, "Machining error". `code` is unique. |
| `category` | Coded, and used to group the Pareto: `material_defect`, `process_error`, `setup`, `handling_damage`, `design_issue`, `supplier_defect`, `other` |
| `quality_defect_code_id` | Optional link to `quality_defect_codes`, so Quality's Pareto can include production scrap |
| `is_active` | Retired, never deleted (the same rule as `QualityDefectCode`) |

### `ProductionScrapNote` (`production_scrap_notes`), number `PSN-YYYY-NNNN`, with `ProductionScrapNoteLine`

| Field | Notes |
|---|---|
| `work_order_id`, `operation_id` (nullable), `time_log_id` (nullable) | Where the scrap happened |
| `scrap_kind` | Coded: `output` (units of the WO's product), `component` (an issued component damaged on the floor), `stock` (unissued component damaged in the line-side store) |
| `status` | `draft`, then either `posted` or `pending_approval` → `approved` → `posted`, or `rejected` |
| `total_value`, `approved_by_id`, `approved_at`, `remarks` | |
| **Line:** `item_id`, `quantity`, `reason_id` (required), `unit_cost` (snapshot), `value`, `location_id` (for `stock` kind) | |
| **Line, recovery (optional):** `recovery_item_id`, `recovery_qty`, `recovery_location_id` | Saleable scrap such as MS turnings by weight, received into a scrap store (§5.3.3) |

### `ProductionReworkOrder`, generalised (no new table)

| Change | Notes |
|---|---|
| `build_id` becomes **nullable** | Add a CHECK so that `build_id` or `work_order_id` is set |
| Add `operation_id` (nullable FK) | The step being reworked |
| Add `quantity` (default 1) | The number of units being reworked |
| Add `defect_code_id` / `scrap_reason_id` (nullable) | Ties rework into the same Pareto |
| `source` gains `shop_floor` and `ncr` | `PRODUCTION_REWORK_SOURCES` |
| Add `rework_order_id` to `production_time_logs` (nullable) | Rework hours are booked as ordinary time logs that are tagged, so they cost at the snapshotted rate and show as *cost of poor quality* |

The `RW-YYYY-NNNN` series stays the same.

## 4.4 Capacity (Topic 4)

| Table / column | Notes |
|---|---|
| `production_workstations.efficiency_percent` (default 100) | Usable share of `capacity_hours_per_day`. For example 85 allows for small stops. |
| `production_work_order_operations.scheduled_start_date`, `scheduled_end_date` | Written only when a planner **applies** a schedule run |
| `ProductionScheduleRun` (`production_schedule_runs`), number `SCH-YYYY-NNNN` | `branch_id`, `horizon_end`, `run_at`, `run_by_id`, `status` (`preview`, `applied`, `discarded`), `params` JSON, `result` JSON (op allocations per day, late WOs, overloaded days). The plan is saved before it is applied, so "why did my job move?" can be answered. |

## 4.5 Plant scoping (Topic 5)

There are no new tables. The changes are:
- `production_work_orders.branch_id`, `production_rrv_builds.branch_id` and `production_demands.branch_id` become **required for new rows** while plant access is ON. This is checked in the service layer, not by a NOT NULL constraint, so legacy rows stay valid.
- A backfill migration fills `branch_id` from each WO's source location (`StoreLocation.branch_id`), and fills each build's `branch_id` from its main WO.

## 4.6 Changes to other modules' tables

| Table | Change | Phase | Owner |
|---|---|---|---|
| `store_items` | Add `lead_time_days` (nullable int, purchase lead time in **calendar** days). This is the same column as Engineering plan §4.3. | 1 | Whichever session ships first. The other session reuses it and does **not** add it again. Check `alembic heads` and the model first. |
| `store_stock_transactions` | Add `unit_cost` (nullable float) | 0 | Store |
| `store_items.moving_average_cost` | Maintained on every priced receipt (§5.2.0). This is a behaviour change, not a column. | 0 | Store and P2P (GRN) |
| `STORE_STOCK_TXN_REFERENCE_TYPES` | Add `production_scrap` | 3 | Production (a one-line tuple edit) |
| `p2p_request_items`, `p2p_purchase_order_items` | `store_item_id` (P2P plan §14 rule 5). It is **not required** here: MRP matches by name and code until it exists (§5.1.3). | — | P2P |
| `production_boms` | Add `lead_time_days` (nullable override of the routing-derived manufacturing lead time) and `issue_method` on `production_bom_items` (`manual` by default, `backflush`; §5.2.5) | 1 / 4 | Production |

---

# 5. Workflows

## 5.1 Multi-level MRP (Topic 1)

### 5.1.1 Run

```
Planner: Planning → MRP → "Run MRP" (plant, horizon)       [or nightly job if setting on]
  1. Collect demand
       independent: open ProductionDemand rows (required_date)
       dependent:   outstanding qty of every open WO material line (draft*/released/in_progress),
                    dated at the WO's planned_start_date (or today if unset/past)
  2. Compute low-level codes from ACTIVE production BOMs (deepest level each item appears at);
       a cycle (A→B→A) fails the run with the loop named
  3. For level 0, 1, 2 … : for each item, bucket by bucket
       projected = projected_prev + scheduled_receipts − gross
       if projected < safety_stock → planned order (lot-sized), receipt in this bucket,
                                      release = bucket − lead time
       make item (has active BOM)  → explode planned order through its BOM: its components
                                      get gross demand at the planned RELEASE date (next level)
  4. Exceptions: expedite / defer / cancel on existing supply, assumed lead times,
       planned releases already in the past ("late — release today, expect N days late")
  5. Save run + lines; previous run for the plant → superseded
```
*Drafts are included when the `mrp_include_draft_work_orders` setting is on (the default, matching today's planner).

### 5.1.2 Supply (scheduled receipts) and how each is dated

| Supply | Quantity | Date |
|---|---|---|
| Free stock | `on_hand − reserved`, summed over the plant's stores. The open WO lines that hold the reservations already have that much of their demand covered, which is today's rule. | Opening balance |
| Quality stock (`quality_qty`) | Received and waiting for inspection | Today + `mrp_inspection_buffer_days` (default 2) |
| GRN drafts (`p2p_goods_receipts.status = draft`) | Received quantity not yet posted | Same as Quality stock |
| Open POs (`issued`, `acknowledged`, `partially_fulfilled`) | Line qty − Σ GRN received qty on that line | `expected_delivery`. If that is empty, PO date + item lead time, flagged. |
| Open child WOs for a make item | `quantity_planned − quantity_completed` | `planned_end_date`, or today if it is unset |
| Blocked stock (`quarantine_qty`) | **Not counted.** It is rejected or damaged material. | — |
| Approved, unconverted PRs | **Not counted as supply.** Shown in `open_pr_qty` and subtracted from the *buy suggestion* only. | PR required date |

> **ERP standard / why: MRP netting.** MRP answers *what, how much and when* from one equation per item per time bucket: **net requirement = gross requirement − on hand − scheduled receipts (+ safety stock)**. "Scheduled receipts" means supply that is *already committed*: open purchase orders, open production orders, and stock received but not yet usable. Leaving any of them out makes MRP shout for things that are already on the way, and planners soon learn to ignore it. That is today's failure mode: the Planning page ignores open POs, so every shortage looks like a new purchase. PRs are **not** scheduled receipts, because nobody has committed to supply yet. They are still subtracted from *buy suggestions* so the same shortage isn't requested twice (the same rule as Engineering §5.6).

> **ERP standard / why: low-level code.** An item can sit at level 1 in one BOM and level 3 in another. If MRP netted it at level 1 first, it would net it again when level 3 demand arrived, and double-plan it. Standard MRP assigns each item its **deepest level** (the low-level code) and processes all items level by level. That way an item is netted exactly once, after *all* of its parents have dropped their demand on it.

> **ERP standard / why: lead-time offset.** A planned order is needed *at* the date of the shortage, but it must be **released** (PO placed or WO started) one lead time *earlier*. Purchase lead time is counted in calendar days, because suppliers don't stop on our holidays. Manufacturing lead time is counted in **working days** of the plant calendar (Topic 4). When the release date is already in the past, the line becomes an exception ("release today, expect 6 days late"). It is not silently moved forward, because the lateness is the information the planner needs.

### 5.1.3 Lead times, lot sizing and matching

- **Buy items:** `store_items.lead_time_days`. When it is missing, use `mrp_default_purchase_lead_days` (default 14) and flag the line as "assumed" with a count on the run header, for example: "23 items have no lead time. Set it in Store → Items to make this plan reliable."
- **Make items:** `production_boms.lead_time_days` if it is set. Otherwise compute it from the routing: ceil(Σ (setup + run × qty) ÷ (capacity × efficiency) of each operation's workstation) working days, with at least 1. An operation with no workstation counts as 1 day.
- **Lot sizing:** lot-for-lot (exactly the net requirement), rounded **up** to `reorder_quantity` when it is set. Here `reorder_quantity` acts as the minimum order quantity. Serial-controlled items are rounded up to whole units.
- **Safety stock:** `store_items.safety_stock` is a floor that projected on-hand must not drop below, when `mrp_respect_safety_stock` is on (the default).
- **Matching a PO or PR line to a Store item.** P2P lines have no `store_item_id` yet. Use the **same rule GRN posting uses**: `lower(item_name)` equals the Store item's name (`goods_receipts.py:76`). Fall back to `part_code = item_code`. Unmatched open PO lines are listed on the run as "open POs MRP couldn't match to an item". They are listed, not guessed.

### 5.1.4 Acting on a run

- **Make suggestions → child work orders.** The planner ticks make lines and clicks **Create work orders**. For each line the service:
  - creates a **draft** WO from the item's active BOM, using `explode_bom` as today
  - sets `parent_work_order_id` (from the pegging, when the need came from a single WO), `mrp_run_id` and `demand_id`
  - sets `planned_end_date` = the need date − 1 working day, and `planned_start_date` = end − manufacturing lead time (backward scheduled on the plant calendar)
  - copies `branch_id`, `erp_project_id`, `rrv_build_id` (with role `sub_assembly`) and `priority` from the parent
  - defaults **target location = the parent WO's source location**, so the sub-assembly lands where the parent issues from

  Nothing is released automatically. Release stays a human decision with the existing checks.
- **Buy suggestions → one multi-line PR.** The planner ticks buy lines and clicks **Raise PR**. The page writes:
  `sessionStorage['p2p_new_prefill'] = {items: [{item_name, part_code: item_code, make, unit, quantity, category}], remarks: "MRP MRP-2026-0012 · Plant 1 · 14 items · earliest release 09-10-2026 · …"}`
  It then opens `/dashboard/p2p/new?prefill=session`. The requester reviews and submits, and P2P's approval chain is unchanged. The next run picks the PR up through `open_pr_qty` and fills `converted_ref`.
  - One small optional P2P edit, made only with the P2P owner's agreement: accept `required_date` in the pre-fill (the earliest planned release date). Until then it goes in `remarks`.
- **Expedite / defer exceptions** are informational. They link to the PO or WO and do not change it.
- **Demand coverage:** converting a planned order for a `ProductionDemand` sets its status to `covered`.
- **Parent release check (soft):** releasing a WO whose child WOs aren't completed shows a warning, not a block. For example: "Sub-assembly WO-2026-0031 (Rail gear) is still in progress. The parent can be released, but its kitting will be short of that item." RRV builds already hard-gate this at the Sub-Assemblies stage.

> **ERP standard / why: planned orders are suggestions.** MRP output is a *proposal*. In SAP, planned orders only become production or purchase orders when a planner converts them, and the next run deletes and recreates unconverted proposals. That is why runs here are read-only snapshots, and conversion is an explicit action that leaves a trace (`converted_ref`, `mrp_run_id`). Auto-creating orders from a nightly run, with data quality where it is today, would flood Store and Purchase with orders nobody checked.

> **ERP standard / why: pegging.** Pegging records which top-level demand each requirement came from, for example "this 20 m of cable is for RRV-2026-0007 via the harness sub-assembly". With pegging, a planner can see what slips if a PO is late, and which RRV a shortage hurts.

## 5.2 FG receipt valuation and WO settlement (Topic 2)

**Decision D5 governs this whole topic.** Inventory is **periodic**. Nothing posts to the GL on GRN, issue or FG receipt. The only GL inventory entry is the closing-stock valuation at period end, which is auto-reversed (`accounts/services/inventory.py`). This topic therefore builds **management costing**: correct numbers for reports and for the weighted-average rate that the closing-stock entry reads. It does **not** build WIP or variance GL accounts.

### 5.2.0 Prerequisite: weighted average must actually be maintained (Store, Phase 0)

- On every **priced receipt** (a GRN line with a PO `unit_price`, excluding GST because input credit is taken):
  `avg_new = (Q_onhand_all_stores × avg_old + Q_rcpt × rate) ÷ (Q_onhand_all_stores + Q_rcpt)`
  The result is written to `store_items.moving_average_cost`, and `unit_cost = rate` is written on the ledger row.
- On every **issue**, transfer or adjustment: `unit_cost = avg at that moment` on the ledger row. Issues don't change the average.
- A receipt with no price (opening stock or a manual receipt) uses the current average, or `standard_cost` when there is no average. The row is marked so the "unvalued" count in Accounts stays honest.
- The cost is held company-wide per item, because the item has one cost. A per-plant cost is a later decision (§13 Q6).

> **ERP standard / why: standard vs actual (moving average) cost.** *Standard cost* is a planned rate fixed in advance. It makes costing fast and stable, and every difference shows up as a **variance**, which is the point of it. *Moving (weighted) average* follows real purchase prices, so stock value is close to actual cost, but cost per unit moves with every receipt. D5 chose weighted average for stock valuation. For the reports this plan does **both**: standard from the BOM is the yardstick, actual at weighted average is the result, and the variance is explained. For costs to be reproducible, the rate must be **snapshotted at the moment of the transaction** (`unit_cost` on the ledger row, `hourly_rate` on the time log). Recomputing at read time with today's rate, as `work_order_costing()` does now, changes last month's RRV cost every time a GRN comes in.

### 5.2.1 Standard (estimated) cost of a WO

- **Material:** Σ over the WO's own material lines of `required_qty × standard_cost`. If `standard_cost` is missing, fall back to the average at release. These are the snapshotted BOM lines, so a later BOM version doesn't change it.
- **Labour / machine:** Σ planned hours × the workstation `hourly_rate` at release.
- These figures are frozen on the settlement. While the WO is open, they are computed live.

### 5.2.2 Actual cost of a WO

| Element | Source |
|---|---|
| Material | Σ of the WO's ledger issues `qty × unit_cost` − Σ returns `qty × unit_cost`. This covers extra issues that weren't on the BOM. For a child WO's output consumed by a parent, it is the cost the child's receipt was valued at, so cost **rolls up through stock**. |
| Labour / machine | Σ time logs `hours × hourly_rate (snapshot)` with no `rework_order_id` |
| Rework | Σ time logs tagged `rework_order_id` × rate, plus material issued against the rework |
| Job work / external | Σ `ProductionWorkOrderCharge.amount` |
| Scrap | Already inside material and labour, because scrapped parts were issued and worked on. It is **shown separately** (Σ posted scrap-note value) and is not added again. |
| Scrap recovery | Recovery qty × the recovery item's average, as a credit |

The WO's labour rate is the workstation's all-in `hourly_rate`, covering labour and machine. A per-skill labour rate table (§42 "Labour rate per hour by skill") is §13 Q8.

### 5.2.3 FG receipt valuation (provisional)

`receive_output` posts its ledger `receipt` with `unit_cost = provisional unit cost`, chosen by the `costing_fg_receipt_basis` setting:
- `standard` (default): standard cost per unit from §5.2.1.
- `actual_to_date`: (actual material + labour so far) ÷ qty planned. This suits single-unit RRV WOs, where receipt happens after every operation is complete.

The FG item's `moving_average_cost` is re-averaged with this receipt in the same way as a purchase receipt.

### 5.2.4 Settlement at close

`POST /work-orders/{id}/close`, which already exists, now:

1. Refuses to close while any rework on the WO is open, or any scrap note is `pending_approval`.
2. Computes actual cost per §5.2.2 and actual unit cost = `act_total ÷ qty_received`.
3. Computes the variance and splits it into:
   - **material price:** actual issue rate vs standard, at actual qty
   - **material usage:** actual qty vs required, at standard
   - **labour rate**
   - **labour efficiency:** actual hours vs planned
   - **scrap**
   - **rework**
4. **FG revaluation (stock coverage):** `diff = actual_unit − provisional_unit`. For the received units still in stock (capped at the item's on-hand), the FG item's average moves by `diff × covered_qty ÷ on_hand_total`. The part of the variance for units already issued or dispatched is reported only. Nothing is restated.
5. Writes the frozen `ProductionWorkOrderSettlement`. A closed WO is never recosted. A correction is made by reopening, which is admin-only and leaves an audit trail.

> **ERP standard / why: settlement.** In a perpetual-inventory ERP, a production order collects cost (WIP) and *settles* it at period end or at completion, crediting the order and debiting stock or variance accounts. Under D5 there are no WIP or variance GL accounts. The **same discipline** still applies to management numbers: freeze the order's cost at close, explain the difference from standard, and correct the stock rate only for goods still in stock. Without a freeze, an RRV cost quoted to the partners in March could change in April.

> **ERP standard / why: WIP under periodic inventory.** Material issued to an open WO has left Store stock, so the period-end closing-stock entry (which reads Store only) **leaves out WIP**. A half-built RRV at 31 March then disappears from the balance sheet and shows up as expense. AS-2 counts WIP as inventory. This plan adds a **WIP valuation report** (§6) that Accounts can add to the closing-stock valuation. Whether it is added automatically is a Finance decision (§13 Q5).

### 5.2.5 Backflush vs manual issue

- The default stays **manual issue** against the WO. This matches §42 "Backflush consumption: off".
- Optional, behind setting `backflush_enabled` (off): BOM lines marked `issue_method = backflush` (consumables such as welding wire, paint and fasteners by weight) are auto-issued at **FG receipt**, at `required_qty × received ÷ planned`, from the WO source location. If stock is short, the whole receipt fails with the real numbers. Nothing is partly posted.

> **ERP standard / why: backflush vs manual issue.** *Manual issue* (pick list, issue slip) records consumption when it happens and lets Store control every unit. It is right for expensive, serialised or traceable parts, which describes most of an RRV. *Backflush* posts consumption automatically when output is reported, from the BOM quantities. It saves clerical work for cheap, high-volume items nobody counts one by one, but stock is wrong until output is booked, and over-use only appears at the next count. That is why it is an opt-in per BOM line, and off by default.

## 5.3 Scrap and rework (Topic 3)

### 5.3.1 Booking scrap on the shop floor

- A time log with `qty_scrap > 0` now **requires a scrap reason**, through the `scrap_reason_mandatory` setting, which is locked on. Saving the log creates a `ProductionScrapNote` with `scrap_kind = output` for the WO product at that operation.
- **Component scrap** ("bent a bracket while fitting it") is booked from the WO **Scrap** tab: pick an issued component, a quantity no greater than the net issued quantity, and a reason. A replacement then needs a fresh issue, which shows as usage variance.
- **Stock scrap** (damaged in the line-side store before issue) is booked from the same tab with a location.

### 5.3.2 Approval and posting

| Note value (Σ qty × snapshotted unit cost) | Flow |
|---|---|
| ≤ `scrap_approval_value_limit` (default ₹25,000) | Posts immediately |
| Above the limit | `pending_approval`, and the Production Manager is notified (Teams, since it is an approval). The approver must not be the person who booked it. Rejecting it needs a reason and reverses the time log's scrap count. |

### 5.3.3 Stock effect of posting

| Kind | Ledger posting | Why |
|---|---|---|
| `output` | None. The units were never received. `wo.quantity_scrapped` is updated (as today). | Scrapped output never enters stock. Its cost is already in the WO. |
| `component` | None. The component was already issued (it left stock at issue). | Posting again would count it twice. The note records **why** it was consumed. |
| `stock` | `damage` (existing outbound type), `reference_type = "production_scrap"` | The material is still in the store and has to leave it |
| Recovery (any kind) | `receipt` of the recovery item into the scrap store, `reference_type = "production_scrap"`, `unit_cost` = the recovery item's average | Saleable scrap such as turnings and offcuts becomes stock that Sales or Store can dispose of |

### 5.3.4 One path per event (with Quality)

- A defect found **at a quality gate or final lot** belongs to Quality: lot rejection, then NCR, then disposition. An NCR disposition of `scrap` already posts `quarantine_out` (`quality/services/ncr.py:385`). Production does **not** book a scrap note for the same units. Instead, a new hook `production.service.on_ncr_scrap(ncr)` increments `wo.quantity_scrapped` and records a read-only scrap note with `source = ncr`, so WO scrap totals and the Pareto stay complete. Quality calls this hook, so the change is coordinated with the Quality session (§11).
- A defect found **by Production itself** before any gate goes through the Production scrap note, as above.

> **ERP standard / why: planned vs actual scrap.** `scrap_percent` on the BOM line is *planned* scrap: it inflates the requirement so the kit is big enough. *Actual* scrap is booked when it happens, with a reason. Comparing the two is how process engineering knows whether a BOM allowance is right. Reasons are a **master of values**, so the Pareto is stable: free text can't be grouped, and a hard-coded list can't grow with the shop. Categories stay **coded** (D8) because reports group by them.

### 5.3.5 Rework on ordinary work orders

- **Raise:** manually from the WO (operation, quantity, defect or reason, assignee, due date), or **automatically** when an in-process gate lot on *any* WO is rejected (setting `rework_auto_raise`, default on). Today the automatic path only runs for WOs in an RRV build (`service.py:637`), and this change generalises it.
- **Lifecycle:** unchanged: `open` → `in_progress` → `done` → `verified`, or `cancelled` with a reason. The verifier must not be the doer (locked). Verification needs the failed check to pass again. `rework_verification_problem()` already handles gate lots without a build.
- **Cost:** hours are booked as time logs with `rework_order_id`. Material goes through ordinary WO issues, with the rework number in the remarks. Both land in `act_rework` (§5.2.2).
- **Gates:** a WO cannot be **completed** while rework on it is open. RRV builds keep their `rework_closure` stage gate unchanged.
- **UI:** a **Rework** tab on the WO detail, and a module-wide **Rework** page (new subtab `rework`) that replaces the RRV-only list. The old `/production/rrv-builds/rework*` endpoints stay as aliases for one release.

> **ERP standard / why: rework vs scrap.** Rework spends more labour (and sometimes material) to bring a part back into specification. Scrap writes the part off. Both are **cost of poor quality**, and both need a reason and a verifier, or rework becomes a way to hide defects. Rework is booked against the original order, rather than as a new order, so the *real* cost of the units that were made includes the second attempt.

## 5.4 Capacity planning (Topic 4)

### 5.4.1 Working calendar

A new module, `production/services/calendar.py`, is a thin wrapper over `hr/services/calendar.CalendarCache`:
- `is_working_day(branch_id, d)`: the weekday is in `parse_working_days(Branch.working_days)` and there is no blocking (national or festival) `HrHoliday` for that plant or for all plants.
- `add_working_days(branch_id, d, n)` and `working_days_between(branch_id, a, b)`.
- `capacity_hours(workstation, d)`: `capacity_hours_per_day × efficiency_percent ÷ 100` on a working day, and 0 otherwise. It is also 0 while the workstation is `under_maintenance`.
- Phase 4b (optional): also 0 on the due date of a Maintenance PM plan with `requires_shutdown`.

Every hard-coded Mon–Sat in Production (`routes/reports.py:25`) moves onto this service. There is one calendar for HR, Maintenance and Production.

### 5.4.2 Finite scheduling by day buckets

```
Planner: Planning → Capacity → "Schedule" (plant, horizon)
  queue   = released + in_progress WOs (drafts optional), sorted by
            priority (urgent→low), then planned_end_date, then wo_number
  for each WO, operations in sequence (skip completed; in-progress op keeps remaining hours):
      earliest = max(today, WO planned_start_date, previous op's finish day)
      walk working days from `earliest`: take min(remaining_hours, free capacity that day)
      on the op's workstation until remaining hours = 0  → scheduled_start / scheduled_end
      op with no workstation → infinite capacity, 1 day, flagged
  result: per-op dates, per-WO projected finish vs planned_end_date (late by N working days),
          per-workstation × day load grid, overloaded days (only possible for in-progress ops pinned to today)
  "Apply" writes scheduled_* on the operations and marks the run applied; "Discard" leaves nothing
```

- **Remaining hours** = planned hours − logged hours (the existing logic).
- A quality gate counts as `quality_gate_buffer_days` (default 1) before the next operation can start.
- Shop-floor queue (`routes/shop_floor.py`) ordering: ops with an applied `scheduled_start_date` first, by date. Today's order is the fallback.

> **ERP standard / why: infinite vs finite, backward vs forward.** MRP plans with **infinite capacity**, scheduling **backward** from the due date. It answers "when must this start?" and assumes the shop can do it. **Capacity planning** then checks that assumption. Load-vs-capacity shows the overload, and **finite forward scheduling** answers "given what's already queued on each machine, when *will* it finish?". Day buckets are the right grain for a shop that builds RRVs in days and weeks. Hour-level sequencing (APS) adds a lot of data entry for little gain at this volume. Priority, then due date, is the standard simple dispatching rule, and it is easy to explain on the floor.

## 5.5 Plant scoping (Topic 5)

- A new module, `production/services/plant_access.py`, **reuses Store's resolver**: it imports `user_plant_ids` and `is_unrestricted_user` from `store/services/plant_access.py`. When Store → Settings → Plant Access is ON, a Production user sees only their plants. The recommended default is **one switch for both modules**, so there is one place to answer "who sees plant 2?" (§13 Q3).
- **Scoped by `branch_id`:**
  - work orders (and through them, time logs, scrap notes, rework, charges and settlements)
  - RRV builds
  - workstations
  - demand rows
  - MRP and schedule runs
  - dashboard, planning and reports
- **Not scoped:** BOMs. They are the product definition and are company-wide, like the Item Master.
- **Write rules:**
  - A WO's source and target stores must belong to the WO's plant, checked with `ensure_location_allowed` plus a same-plant check. Example error: "Store 'Unit-2 Main' belongs to Plant 2, but WO-2026-0044 is a Plant 1 order. Pick a Plant 1 store, or move the order to Plant 2."
  - An operation's workstation must be in the same plant. A mismatch is a warning, not a block, because a workstation can be borrowed across plants.
  - A child WO may be in a **different plant** from its parent, for example a sub-assembly made at Unit 2 for an RRV at Unit 1. This is allowed, and the MRP line says a stock transfer is needed.
- **Detail views** of an out-of-scope record return 403 with the Store-style message ("… belongs to another plant … ask an admin to add that plant in Store → Settings → Plant Access").
- **Backfill:** a migration fills `branch_id` on WOs and builds (§4.5). The Production settings page lists records and workstations still without a plant, as the Store page does for stores.

> **ERP standard / why: plant as an organisational unit.** In SAP the plant is the unit that owns stock, capacity, MRP and production orders, and authorisations are granted per plant. Scoping Production by the same plant field Store already uses keeps the two consistent. A Unit-2 planner sees Unit-2 stock, Unit-2 machines and Unit-2 orders, and MRP for Unit 2 nets only Unit-2 stores.

---

# 6. Reports and dashboard

| Report | Content |
|---|---|
| **MRP run** (Planning → MRP) | Tabs: Buy suggestions (with open PR, long-lead first), Make suggestions, Exceptions (expedite, defer, assumed lead time, unmatched POs), Item time-phased view (the MRP record table per bucket), Pegging. Excel export. |
| **Capacity** (Planning → Capacity) | Workstation × day heatmap (load ÷ capacity %), late WOs, unassigned-workstation operations. Excel export. |
| **WO cost sheet** | Standard vs actual by element, variances split (§5.2.4), and settlement status. It is on the WO **Costing** tab, which replaces today's live-only view. |
| **RRV cost report** | Per build: Σ over its WOs (main and sub-assembly, so child WOs are not counted twice; their output enters the parent at the receipt value) of material, labour, job work, rework, scrap and recovery. Shows standard, actual, variance and cost per vehicle. Filtered by model, customer, date and plant. Excel export, and an optional **Word cost sheet** of record (D4) in a later phase. A management report only, not a GL posting (D5). |
| **WIP valuation** | Open WOs at a date: net issued material at snapshot cost + labour and rework + charges − FG received at provisional cost. Per plant and per WO. Accounts uses it at period end (§13 Q5). |
| **Scrap analysis** | Pareto by reason and category, by item, workstation, operator and month. Value, qty and scrap % vs BOM `scrap_percent` (planned vs actual). Includes NCR-sourced scrap. |
| **Rework** | Open rework by age, hours and cost by reason, and repeat offenders by operation. |
| **Data-quality panel** | Items in BOMs with no lead time, items with no average or standard cost, workstations with rate 0, WOs and workstations without a plant. This is what makes MRP and costing trustworthy. |

The dashboard gains tiles for late WOs (from the last applied schedule), today's MRP exceptions, scrap this month (value), and open rework.

---

# 7. API design

All routers are under `/api/v1/production/...` with `require_app_access("production")` and tab actions as today.

## 7.1 New routers

| Router file | Endpoints |
|---|---|
| `routes/demand.py` | `GET/POST /production/demand`, `PATCH/DELETE /{id}`, `POST /{id}/cancel` |
| `routes/mrp.py` | `POST /production/mrp/runs` (run), `GET /production/mrp/runs`, `GET /runs/{id}` (header + summary), `GET /runs/{id}/lines?action=&item_id=`, `POST /runs/{id}/create-work-orders` (line ids, returns the created WO numbers), `POST /runs/{id}/lines/{line_id}/link-pr` (manual back-link) |
| `routes/capacity.py` | `POST /production/capacity/schedule` (preview run), `GET /schedule/{id}`, `POST /schedule/{id}/apply`, `POST /schedule/{id}/discard`, `GET /production/capacity/calendar?branch_id=&from=&to=` |
| `routes/scrap.py` | `GET /production/scrap-notes`, `POST /production/work-orders/{id}/scrap-notes`, `POST /scrap-notes/{id}/approve`, `/reject` |
| `routes/rework.py` | `GET /production/rework`, `POST /production/work-orders/{id}/rework`, `POST /rework/{rid}/start`, `/done`, `/verify`, `/reject-verification`, `/cancel` (shared logic moves out of `rrv_builds.py`, which keeps aliases) |
| `routes/settings.py` | Scrap reason master CRUD (`/production/settings/scrap-reasons`), plus `make_settings_router("production")` from the settings framework |
| `routes/costing.py` | `GET /production/work-orders/{id}/cost-sheet`, `GET/POST/DELETE /production/work-orders/{id}/charges`, `GET /production/reports/rrv-cost`, `GET /production/reports/wip`, `GET /production/reports/scrap` |

## 7.2 Changes to existing endpoints

- `POST /work-orders` accepts `parent_work_order_id` and `demand_id`.
- `POST /work-orders/{id}/close` performs the settlement (§5.2.4).
- `POST /work-orders/{id}/receive-output` writes the provisional `unit_cost` and runs the backflush when it is enabled.
- `POST /time-logs` requires `scrap_reason_id` when `qty_scrap > 0`, snapshots `hourly_rate`, and accepts `rework_order_id`.
- `GET /production/planning` stays, so the old page keeps working, but its requirements block is marked as superseded by MRP runs.
- Every list endpoint applies plant scope in Phase 5.

## 7.3 Permission registry

Add two subtabs to `MODULES["production"]` in `core/permission_registry.py`: `rework` ("Rework") and `settings` ("Settings").

- MRP and capacity sit under `planning`.
- Costing sits under `work_orders` (view) and `reports`.
- Settings edits need admin or an explicit `production:settings:edit` grant (the framework rule).

---

# 8. Frontend

| Route | Page |
|---|---|
| `production/planning/page.tsx` | Becomes a hub with three tabs: **MRP** (run list, plus a "Run MRP" button with plant and horizon), **Capacity**, and **Demand**. Today's requirement table moves into the MRP run detail. |
| `production/planning/mrp/[id]/page.tsx` | Run detail (§6) with checkbox selection. The actions are **Create work orders** (make lines) and **Raise PR** (buy lines, multi-line `p2p_new_prefill`). Raise PR is shown only to users with the `p2p` app, as today. |
| `production/planning/capacity/page.tsx` | Heatmap, late list, **Schedule → Preview → Apply**. Apply and Discard use `ConfirmDialog`. |
| `production/planning/demand/page.tsx` | Demand list and form |
| `production/work-orders/[id]` | New tabs: **Sub-assemblies** (child WOs and parent link), **Scrap**, **Rework**, and **Costing** (cost sheet, charges, settlement) |
| `production/rework/page.tsx` | Module-wide rework list. This is the new subtab, and the RRV page links here with a build filter. |
| `production/settings/page.tsx` | Scrap reasons master, Production settings (framework form), and plant-access status (link to Store settings plus the list of records without a plant) |
| `production/reports/page.tsx` | Adds RRV cost, WIP, scrap Pareto and rework, each with export |

UI rules, the same as every module:
- `ProductionNav` sits **above** the header.
- "← Back" uses the secondary pill at the top-right of the header row.
- Use `ConfirmDialog` and `PromptDialog` (reject and cancel reasons), never browser dialogs.
- Error banners show the backend's real message.
- Pickers follow `premnathrail-ui-behavior` (searchable item, reason and workstation selects).
- Production guided tours are updated for the new tabs.

---

# 9. Settings (`register_module_settings("production", ...)`, values only)

| Group | Key | Type | Default | Read by |
|---|---|---|---|---|
| MRP | `mrp_include_draft_work_orders` | bool | true | 5.1.1 |
| MRP | `mrp_bucket` | select day/week | week | 5.1.1 |
| MRP | `mrp_horizon_days` | int | 180 | 5.1.1 |
| MRP | `mrp_default_purchase_lead_days` | int | 14 | 5.1.3 |
| MRP | `mrp_inspection_buffer_days` | int | 2 | 5.1.2 |
| MRP | `mrp_respect_safety_stock` | bool | true | 5.1.3 |
| MRP | `mrp_nightly_run` | bool, per plant | false | 5.1.1 |
| Costing | `costing_fg_receipt_basis` | select standard/actual_to_date | standard | 5.2.3 |
| Costing | `backflush_enabled` | bool | false (§42) | 5.2.5 |
| Scrap | `scrap_reason_mandatory` | bool, **locked** | true | 5.3.1 |
| Scrap | `scrap_approval_value_limit` | decimal (₹), per plant | 25000 | 5.3.2 |
| Rework | `rework_auto_raise` | bool | true (§42) | 5.3.5 |
| Rework | `rework_verifier_not_doer` | bool, **locked** | true (§42) | 5.3.5 |
| Capacity | `schedule_horizon_days` | int | 90 | 5.4.2 |
| Capacity | `schedule_include_drafts` | bool | false | 5.4.2 |
| Capacity | `quality_gate_buffer_days` | int | 1 | 5.4.2 |

The scrap reason master is a table (§4.3), because the framework's "simple master lists" are still a TODO in `settings_framework.py`. It moves into the framework when that exists.

---

# 10. Notifications

These use the existing `notify_user`. Teams is used **only for approvals and reminders**. Everything else is bell-only.

| Type | Recipients | When | Teams |
|---|---|---|---|
| `production_mrp_run_completed` | The person who ran it (nightly runs go to planners of that plant) | Run finished, with counts and exceptions | No |
| `production_child_wo_created` | Supervisor of the parent WO | Child WOs created from MRP | No |
| `production_scrap_approval_needed` | Production Managers of the plant | Scrap note above the limit | **Yes** |
| `production_scrap_rejected` | The person who booked it | Rejected, with the reason | No |
| `production_rework_raised` | Assignee, WO supervisor | Raised manually or automatically | No |
| `production_rework_overdue` | Assignee, supervisor | Daily while past due, at most once per day (the `hr_reminders.py` check) | **Yes** (reminder) |
| `production_wo_settled` | WO creator, Production Manager | Close, with the variance % | No |
| `production_schedule_late` | Supervisors of the plant | An applied schedule makes a WO late by more than 0 working days | No |

`ENTITY_LINK` entries for `production_scrap_note`, `production_rework_order` and `production_mrp_run` are added in `components/erp/NotificationBell.tsx`.

---

# 11. Phased delivery and sequencing with parallel sessions

## 11.1 Who else is editing Production right now (git status, 7 October 2026)

| File | State | Owner session | Effect on this plan |
|---|---|---|---|
| `production/routes/work_orders.py`, `routes/shop_floor.py`, `service.py` (gate calls) | **Committed** in `aa9b49f` (Quality Phase 2: gate lots, FAI, final lots on receipt) | Quality Phase 2 | `receive_output`, `complete_operation` and `start_operation` now call `quality.services.production_gates` and `lots`. Topic 2 edits `receive_output`, and must **keep** the gate and final-lot branches exactly as they are, adding cost on both branches. |
| `production/routes/rrv_builds.py`, `frontend/.../rrv-builds/[id]/page.tsx` | **Uncommitted** (Word handover certificate, `managed_documents`) | Word-documents session | Topic 3 moves the rework endpoints out of `rrv_builds.py`. **Don't start Phase 3 until this diff is committed.** |
| `frontend/src/components/production/ProductionNav.tsx` | **Uncommitted** (Project Work tab, `TourButton`) | PM / tours session | Phase 3 adds the `Rework` and `Settings` tabs. Re-read the file just before the edit. |
| `frontend/.../production/project-work/` | **Untracked** | PM department workflow | No overlap |
| `quality/services/ncr.py`, `lots.py`, `first_article.py`, `settings.py`; migration `5d8a3c6e2f71_quality_phase3_improvement.py` | **Uncommitted / untracked** | Quality Phase 3 (CAPA, complaints, supplier quality) | The `on_ncr_scrap` hook (§5.3.4) and the generalised auto-rework (§5.3.5) touch the Quality → Production boundary (`notify_inspection_result`, `rrv_on_inspection_result`). Agree on the hook with that session, or land it after Phase 3 commits. |
| `core/permission_registry.py`, `core/audit_registry.py`, `main.py`, `alembic/env.py` | **Uncommitted** in several sessions | Shared registries | Re-read immediately before editing, and commit only this session's hunks. |
| `alembic/versions/b3d8f1a6c2e9_module_settings.py` | **Untracked**, current head | Settings framework | Every Production migration chains off the head **at the time of writing**. Run `alembic heads` first: it is `b3d8f1a6c2e9` today, and it will move. The settings framework must be committed before Phase 1 can declare settings. |

## 11.2 Build order

The order below is set by risk and collisions, not by topic number:

**Phase 0: Prerequisites (other owners, start now).**
- Store maintains `moving_average_cost` on priced GRN receipts and writes `unit_cost` on ledger rows (§5.2.0).
- Add `store_items.lead_time_days`, shared with Engineering.

*Exit criterion:* a GRN at ₹120 on stock at ₹100 moves the average correctly, and an issue row carries the rate. Topic 2 cannot start without this. Topic 1 can.

**Phase 1: Multi-level MRP.**
- Demand plan, MRP run and lines, low-level codes and loop detection, time-phased netting with POs, GRN drafts, Quality stock and child WOs.
- Lead times, lot sizing, child WO creation, multi-line PR.
- **Mostly new files** (`models/mrp.py`, `services/mrp.py`, `routes/mrp.py`, `routes/demand.py`). Existing files only gain the three WO columns and the WO create payload. **Lowest collision risk, so it goes first.** Make-item lead times use the plain Mon–Sat fallback until Phase 2 replaces it.

*Exit criterion:* for a two-level RRV structure, one run proposes the sub-assembly WO, offset by its routing lead time, and the bought-out shortages net of open POs. One click turns the bought-out shortages into one pre-filled multi-line PR, and the next run shows them as `open_pr_qty`.

**Phase 2: Working calendar and finite capacity.**
- Calendar service, schedule run (preview and apply), heatmap.
- Moves `reports._working_days` and MRP make lead times onto the calendar. Adds `efficiency_percent`.
- Touches `planning.py`, `reports.py` and `shop_floor.py` (queue order only).

*Exit criterion:* a holiday in `hr_holidays` for Plant 1 pushes a Plant 1 job's scheduled end by one day and doesn't affect Plant 2.

**Phase 3: Scrap and rework for ordinary WOs.**
- Scrap reasons master, scrap notes with approval and stock effect, mandatory reason on time logs.
- Rework generalised: nullable `build_id`, WO rework tab, module-wide rework page, auto-raise on gate rejection for any WO.
- NCR scrap hook.
- **Start only after** the `rrv_builds.py` Word diff and Quality Phase 3 have been committed, and with the hook agreed (§11.1).

*Exit criterion:* scrapping two units at operation 20 with reason "Setup" shows on the WO, the Pareto and the cost sheet. A rejected gate lot on a non-RRV WO raises rework that can't be verified by its doer or before re-inspection passes.

**Phase 4: Costing and settlement.**
- Snapshot `hourly_rate` on time logs, WO charges (job work), provisional FG receipt cost, settlement at close with the variance split and FG revaluation.
- RRV cost report, WIP report.
- Optional backflush (setting off).
- Depends on Phase 0. It touches `work_orders.py` (`receive_output`, `close`) and `service.py` (`work_order_costing`), so it keeps the Quality branches intact.

*Exit criterion:* closing a WO freezes a settlement whose actual material equals Σ ledger `qty × unit_cost`. The RRV report for a build with two sub-assembly WOs doesn't double-count them. Re-running the report after a new GRN gives the same number.

**Phase 5: Plant scoping.**
- Resolver reuse, list and detail filters on every Production router, same-plant write rules, backfill migration, settings page list.
- It touches **every** Production router, so it goes **last**, in one short window after the other phases and the parallel sessions have landed. Re-read every file first.

*Exit criterion:* with Plant Access ON, a Unit-2 planner sees only Unit-2 WOs, workstations, builds, runs and reports, gets a 403 with the real reason on a Unit-1 WO URL, and MRP for Unit 2 nets only Unit-2 stores.

Every phase:
- `backend/app/tests/test_production_<topic>.py`, covering:
  - netting: each supply type and dating, low-level code, loop error, lot sizing and safety stock, open-PR subtraction, name/code matching
  - child WO dates
  - calendar with branch-specific and all-plant holidays
  - scheduling order and late flag
  - scrap approval threshold and stock effect per kind; NCR hook with no double count
  - rework without a build; verifier ≠ doer
  - settlement maths and FG revaluation coverage cap
  - WIP report
  - plant scope 403 and filters
- Model imports in **both** `alembic/env.py` and `main.py`, `register_audited` for each new model, routers in `main.py`, Production tour configs, and this doc turned into `overview.md` sections plus a changelog entry when built.

---

# 12. Wiring checklist

**Backend**
- [ ] `models/mrp.py` (demand, run, line), `models/scrap.py` (reason, note, line), `models/costing.py` (charge, settlement), `models/schedule.py` (schedule run). Import each in `alembic/env.py` **and** `main.py`.
- [ ] `services/mrp.py`, `services/calendar.py`, `services/scheduling.py`, `services/costing.py`, `services/plant_access.py`. Extract the rework logic from `service.py` into `services/rework.py` and keep re-exports for Quality's imports.
- [ ] Routers in §7.1, included in `main.py`
- [ ] `register_audited(...)` for every new model (lines use `parent_attr`)
- [ ] `permission_registry.py`: subtabs `rework` and `settings`
- [ ] `register_module_settings("production", ...)` (§9)
- [ ] One migration per phase, chained off the **current** `alembic heads`. Each migration is idempotent (inspector checks), as the recent migrations are.
- [ ] `STORE_STOCK_TXN_REFERENCE_TYPES` gains `production_scrap`
- [ ] Number series: `PD-`, `MRP-`, `SCH-`, `PSN-`, using the existing `_next_number` (advisory lock)
- [ ] Optional nightly MRP job registered in the `main.py` startup (only when `mrp_nightly_run` is on for a plant)

**Frontend**
- [ ] `productionApi` additions in `lib/api.ts`, plus types in `types/index.ts`
- [ ] Pages in §8, `ProductionNav` tabs `Rework` and `Settings`
- [ ] `ENTITY_LINK` entries (§10)
- [ ] Production tour configs, registered in `lib/tour/registry.ts`

---

# 13. Open questions

Each question has a recommended default. A phase can start on the default.

1. **Who builds weighted-average maintenance, and when?** (It blocks Phase 4.) Today nothing writes `moving_average_cost`. The Accounts closing-stock entry and every cost report read a value someone typed in.
   *Default:* the Store session builds it as Phase 0, with the GRN rate excluding GST and the cost held company-wide.
2. **What is the independent demand for MRP?**
   *Default:* open WOs plus a manual demand plan (`ProductionDemand`). An RRV build without a main WO can create a demand row in one click. Sales-order demand is a later step, following the D2 caution on cross-module links.
3. **Plant access: share Store's switch, or keep a separate Production switch?**
   *Default:* share it (one config, `store/services/plant_access.py`). A separate switch is only worth it if Production staff should be scoped while Store staff are not.
4. **Open POs and PRs have no plant and no `store_item_id`.**
   *Default:* MRP matches by item name, then part code (the GRN rule). In a plant-scoped run, POs are attributed to a plant through their linked PR's ship-to when one exists. Otherwise they count company-wide and are flagged. Adding `store_item_id` and plant to P2P lines would remove both guesses.
5. **Should WIP go into the period-end closing-stock entry?** AS-2 says WIP is inventory. Today's periodic entry reads Store only, so WIP is expensed.
   *Default:* Production provides the WIP report and Accounts decides. Recommendation: add it as a separate valuation line set.
6. **Per-plant item cost?** One company-wide average is simpler, and matches how the item master is set up.
   *Default:* company-wide.
7. **Where does job-work cost come from?**
   *Default:* manual WO charges, referencing the job-work store issue and challan, the PO or the vendor invoice. Pull from Accounts vendor invoices automatically once invoice lines can carry a WO reference.
8. **Labour rate: the all-in workstation rate, or the §42 rate per skill** (fitter, electrician, welder)? Payroll is in ADP, so the portal has no salary data.
   *Default:* the workstation all-in rate (as today). A skill-rate table would need a skill on each time log.
9. **Scrap reasons: a Production master, or reuse Quality defect codes?**
   *Default:* a Production master with an optional link to a defect code, so shop-floor reasons ("setup", "handling") don't clutter Quality's defect list.
10. **Backflush:** confirm it stays off, and name any consumables (welding wire, paint) to mark `backflush` if it is turned on.
11. **Capacity covers machines and work centres only.** People (headcount or skills from HR attendance) aren't modelled.
    *Default:* not in this phase. The assembly-bay workstations' `capacity_hours_per_day` should be set to the crew hours.
12. **MRP for RRVs vs stock items.** RRVs are built to order, but some sub-assemblies (rail gear, bogie frames) may be built to stock.
    *Default:* the planner states stock builds as demand rows with no source. Confirm whether any items should carry `safety_stock` as make-to-stock buffers.
