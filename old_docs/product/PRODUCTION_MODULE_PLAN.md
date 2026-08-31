# Production Department Module — Roadmap

## Design reference: mapping SAP PP/CO concepts onto this plan

SAP's Production Planning (PP) + Controlling (CO) shape — BOM → Routing → Production Order → Material Issue → Time Confirmation → Goods Receipt → Settlement, with standard-vs-actual variance computed at the end — is the industry-standard production costing lifecycle. Same approach as `PURCHASE_DEPARTMENT_MODULE_PLAN.md` and `ACCOUNTS_MODULE_PLAN.md`: use it as a checklist for what a "complete" production module covers, and be explicit about what stays out of scope (real GL/CO posting is Accounts' non-goal boundary, not this module's job).

| SAP PP/CO concept | This portal's equivalent | Status | Deliberately lighter than SAP |
|---|---|---|---|
| Bill of Materials (CS01) | [[design]]'s `engineering_documents` (BOM document type) | Depends on Design | No structured line-item BOM (qty per component) — a BOM is an attached document, not a parseable parts list, until/unless a real need for automated material-requirement calculation emerges |
| Work Center (CR01) | Free-text `machine/resource tag` on `production_order_assignments` (Phase 2) | Not built | No capacity model (hours/day, cost rate per hour) — just an assignment record, no load/utilization math beyond a simple schedule view |
| Routing (CA01) | Not modeled | Not built | Stage field (`fabrication → sub_assembly → ...`) is a fixed sequence, not a per-product configurable routing with per-operation durations |
| Production Order (CO01) | `production_orders` (Phase 1) | Not built | No BOM/routing auto-explosion — a production order here is a stage-tracked container, not a system that calculates its own material/labor requirement from a BOM |
| Material Issue / Backflush (MB1A, CO11) | Store `stock_transactions` with `reference_type="production_order"` (Phase 3) | Not built | No automatic backflush at confirmation — issue is a manual action per the plan, not derived from the BOM automatically |
| Time Confirmation (CO15) | Not modeled | Not built | See "Costing & Variance" phase below — this is the piece worth adding given the integration detail just reviewed |
| Goods Receipt for Production Order (MB31) | Store `stock_transactions` with `reference_type="production_order"`, type `receipt` (finished good back into Store) | Not built | Same non-decision as Purchase's GRN: quantity-entry only, no automatic scrap-percentage calculation |
| WIP Account / Settlement (CO11N) | — | Explicitly not built here | This is real GL posting (Debit WIP, Credit Raw Material/Payroll/Overhead) — belongs to Accounts' read-only rollup at most, never a ledger Production itself maintains. See `ACCOUNTS_MODULE_PLAN.md`'s non-goal boundary |
| Standard vs. Actual Cost Variance (CK11N cost estimate vs. actual) | "Estimated vs. actual" tiles, computed read-only | Not built | No cost-element-level variance (material variance / labor variance / overhead variance split) unless real demand emerges — start with one aggregate number |

The one gap this table surfaces that the original phase list didn't cover: **time/material cost tracking against a production order**, which is what actually lets Accounts (per its own plan) show a Project P&L with production cost included. That's the new phase below.

## Current state

No `production` module exists. Shop-floor execution against a Project once it moves from Design/BOM to build — depends on [[design]]'s BOM and [[store]]'s stock ledger both existing to be fully useful, though the core stage-tracking entity can be built standalone first.

## Phase 1 — Production Orders

- New `production_orders`: `project_id` (FK `erp_projects`), linked BOM reference (once [[design]] exists — nullable/free-text until then), stage (`fabrication → sub_assembly → assembly → testing → painting → dispatch_ready`), planned/actual start-end dates, status.
- List/detail pages under `/dashboard/production`, same list-table + detail-page conventions as every other module (see [[premnathrail-app-design]]).

## Phase 2 — Machine/Resource Allocation & Schedule

- `production_order_assignments`: machine/resource tag, assigned technician, planned window — a Gantt-style schedule view per order. Doesn't need a generic scheduling engine; a simple date-range-per-assignment table is enough for v1.

## Phase 3 — Material Issue from Store

- A production order's material requirement pulls from [[store]]'s stock ledger: an "Issue to Production" action posts a `stock_transactions` row with `reference_type="production_order"`, `reference_id=production_order.id`, via Store's `record_stock_transaction()` service — same integration pattern as Purchase's GRN hook (a function call into Store's service, not a raw insert, so Store's balance/negative-stock invariants stay centralized).
- If material is short, surface it as a blocker on the production order rather than silently allowing negative stock (unlike Store's own manual issue, which defaults to `allow_negative=True` during rollout — Production's issue should default the other way once Store data is trustworthy).
- Each issue transaction's `quantity × StockItem.standard_cost` is the material-cost figure Phase 3.5 below accumulates — no new field needed, just a read against Store's existing data.

## Phase 3.5 — Costing & Variance (new — copies SAP CO15/CO11N's *reporting* shape, not its GL posting)

Per the concept table above, a production order should accumulate enough cost data to answer "what did this actually cost to build," without Production ever writing a GL entry itself:

- `production_order_time_entries`: `production_order_id`, `stage`, technician/user id, hours logged, date — the read-only analog of SAP's CO15 confirmation, but just a log, not a trigger for automatic GL/WIP postings.
- Computed (not stored) on the production order: **material cost** = sum of linked Store issue transactions × `StockItem.standard_cost`; **labor cost** = sum of time entries × a configurable hourly rate (a simple `labor_rate` setting, not a per-work-center rate table); **total actual cost** = material + labor.
- If [[design]] later provides a structured BOM with a cost estimate, surface **estimated vs. actual** side by side and a variance %, the same shape as SAP's standard-vs-actual comparison — but as a read-only display number, not a posted GL variance account.
- This is exactly the data [[project-management]]'s Phase 2 (budget vs. actual) and [[accounts]]'s Project P&L view need to read from — build it here once, both of those consume it by id-reference, never duplicate the calculation.

## Phase 4 — Quality Gate

- Stage advancement (e.g. assembly → testing) is blocked until [[quality]]'s in-process inspection sign-off exists for that stage — a status check against a `quality_inspections` row, not duplicated inspection data.

## Phase 5 — Reporting

- Dashboard: orders by stage, machine utilization, on-time-to-plan %, material shortages blocking orders, and (once Phase 3.5 lands) cost-per-order and estimated-vs-actual variance across all open orders.

## Interconnections

| With | Relationship |
|---|---|
| [[design]] | Consumes the released BOM to know what a production order needs to build — id-reference to `engineering_documents` |
| [[store]] | Material issue posts stock-out transactions via Store's service function — the same "function-call exception" pattern as Purchase's GRN integration; issue transactions also feed Phase 3.5's material-cost calculation |
| [[quality]] | Stage gates block on Quality's in-process inspection sign-off |
| [[maintenance]] | Shares the shop-floor machine registry conceptually — Production's "machine utilization" and Maintenance's "internal asset register" should reference the same machine/asset ids rather than each keeping a separate list |
| [[accounts]] | Reads Phase 3.5's computed material/labor/total cost per production order for its Project P&L view — read-only, Production never posts to a GL account itself |
| [[project-management]] | Reads the same Phase 3.5 cost data for its budget-vs-actual view |

## Cross-cutting

- Register `"production"` in `AVAILABLE_APPS`.
- Build Phase 1 (orders + stage tracking) standalone — it's useful even before Store/Design/Quality exist, just with manual/free-text fields where those integrations will later attach.
- Phase 3.5's cost numbers are always **computed at read time from Store/time-entry data**, never a separately-maintained running balance — avoids the two-sources-of-truth problem a cached total would create.
