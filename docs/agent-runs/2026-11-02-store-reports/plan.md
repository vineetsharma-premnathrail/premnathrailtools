# Store & Inventory Reports — plan (2026-11-02)

Status: PLAN ONLY, nothing built yet. Size: M (cross-module read, permissions, 6-7 files) → build through `requirement-pipeline`.

## 1. Finding: the reports engine already exists, Store just has to plug in

`backend/app/core/reporting/` is a shared reports framework already used by CRM (`app/modules/crm/reporting.py`)
and ERP Service (`app/modules/erp/reporting.py`). A module registers:

- **datasets** = a loader that returns rows (list of dicts) + dimensions, measures, filters, columns, date fields;
- **dashboards** = pages of KPI cards and visuals (`kpi | donut | column | hbar | line | stacked_bar | table`),
  with slicers, date range presets, "click a bar → filters the page" drill, per-visual definitions;
- **explorer reports** (pivot) = any group-by × measures × columns with filters and saved views.

The frontend is one shared component: `components/reports/ModuleDashboardPage` (date range, slicer bar, KPI chips,
charts, drill sheet, detailed data tab, Excel export with charts via `core/reporting/xlsx.py`). CRM's whole Reports
page is 15 lines.

So **no new chart library, no new tables, no migration**. Store gets graphs + filters by writing one provider file.
`frontend/src/app/dashboard/store/reports/` exists but is empty today.

## 2. What the Store owner / admin should see (and why)

Standard inventory reporting answers five questions. Each page below maps to one.

| Question | Page | Why an ERP has it |
|---|---|---|
| Kitna maal pada hai, kahan, kitne ka? | Stock overview | stock value is working capital; category/store split shows where money is tied |
| Kya aa raha hai, kya ja raha hai? | Movements | receipts vs issues trend = consumption rate; adjustments/damage = shrinkage control |
| Kya order karna hai? | Reorder & planning | below-reorder list by vendor is the buyer's daily work list |
| Kaun kha raha hai (dept/project)? | Movements › Issues by department / project | consumption by cost centre feeds project costing in Finance |
| Kya sad raha hai? | Stock overview › Dead stock, ABC | slow/dead stock and ABC class drive what to count, what to liquidate |

## 3. Datasets (backend, `app/modules/store/reporting.py`)

### 3.1 `stock` — snapshot, one row per item × store
Source: `store_stock_balances` ⨝ `store_items` ⨝ `store_locations` (+ `store_item_valuations`, `store_item_plants`).
Scope: `visible_location_ids(db, user)` (plant data-scope, same as the Stock page).

Row fields: item_code, item_name, item_type, category, subcategory, uom, store (location), plant/branch, status,
batch/serial flags, preferred_vendor, on_hand (free), quality_qty, blocked_qty (quarantine), vendor_qty (job work),
reserved_qty, available (= free − reserved), total_qty, reorder_level, minimum_stock, maximum_stock, safety_stock,
reorder_quantity, lead_time_days, rate, value (money), last_movement_date, days_idle.

Derived dimensions:
- **health**: Zero stock / Below minimum / Below reorder / OK / Above maximum (plant-level reorder data from
  `store_item_plants` when present, else item-level — same rule as the existing Reorder page; confirm).
- **bucket** split: Free / Quality / Blocked / With vendor / Reserved.
- **idle age**: 0-90 / 91-180 / 181-365 / Over 365 days since last ledger row (dead-stock view).
- **ABC class** (by value, computed on load across the scoped rows): A = top 70 % of value, B = next 20 %, C = rest.
  Thresholds hard-coded now; can become a Store setting later.

Measures: items, stock qty (sum), stock value (money, sum), below-reorder count, zero-stock count, blocked qty/value,
with-vendor qty/value, reserved qty, idle > 180 days value (money).

Rate rule: valuation `avg_rate` when `valuation_enabled`, else moving average → standard cost → last receipt rate
(same fallback the Stock page uses today). All money fields and measures carry `money=True`, gated by the existing
feature `store › items › stock_values` (no new permission needed for money).

### 3.2 `movement` — range, one row per stock ledger row
Source: `store_stock_transactions` ⨝ item ⨝ location ⨝ created_by; for `reference_type = material_issue` also the issue
header (department, project / work order, issue type, vendor for job work) by `reference_number = issue_number`.
Loader honours the framework's date window (narrow-column select, `transaction_date BETWEEN`), so a 12-month
ledger never loads whole.

Row fields: date, doc type (Receipt / Issue / Return in / Return to vendor / Transfer in / Transfer out /
Adjustment + / Adjustment − / Damage / Quality moves / Job work out/in/consume / Manual in/out), direction (in / out /
internal), item + category + type, store, qty, unit_cost + value (money), reference (doc number, linked), posted by
(people), department, project, issue type, vendor, batch, remarks.

Measures: movements, receipt qty / value, issue qty / value, net qty, adjustment count / value, damage value,
return-to-vendor qty, job-work out qty, transfers.

### Phase 2 datasets (not in this build)
`batch` (expiry ageing), `count` (physical count variance per count), `jobwork` (material with vendor, overdue
challans), `grn` (receipt → inspection → accepted/rejected funnel, vendor rejection %).

## 4. Dashboard pages (Store › Reports)

Slicers on every page: Store, Plant, Item type, Category, Subcategory, Item (search), Preferred vendor.
Every bar / donut segment is a drill: click → page filters on it, click again → clear (same as CRM).

### Page 1 — Stock overview (snapshot, "as of today")
KPIs: Items in stock · Stock value ₹ (money) · Below reorder · Zero stock · Blocked qty · With vendor qty
Visuals:
- Stock value by category — hbar, top 10 (money)
- Stock qty by store — column
- Stock health — donut (Zero / Below min / Below reorder / OK / Above max)
- Stock by bucket per store — stacked bar (Free / Quality / Blocked / With vendor)
- Dead stock by idle age — column, value (money)
- ABC class — donut by value, with item count
- Top 15 items by value — table (money)
Extra slicers: Health, ABC class, Idle age.

### Page 2 — Movements (date range, default this month)
KPIs: Receipts qty · Receipts value ₹ · Issues qty · Issues value ₹ · Adjustments (count, net value) · Damage / scrap value
Visuals:
- Receipts vs issues by month — line, last 12 months
- Movements by type — donut
- Issues by department — hbar
- Issues by project / work order — hbar, top 10
- Receipts by vendor — hbar, top 10
- Adjustments by posted-by — hbar (people → needs Reports › People & performance)
- Top consumed items — table (qty, value)
Extra slicers: Doc type, Direction, Department, Project, Posted by (people), Issue type.

### Page 3 — Reorder & planning (snapshot)
KPIs: Below reorder · Below minimum · Above maximum · Shortfall value ₹ (money)
Visuals:
- Below reorder by category — column
- Below reorder by preferred vendor — hbar (buyer work list)
- Items to reorder — table: item, store, on hand, available, reorder level, shortfall, reorder qty, lead time,
  preferred vendor, link → item. (Open PR qty column = phase 2, needs P2P line join.)
Page fixed filter: health in (Below reorder, Below minimum, Zero stock).

### Detailed data tab (explorer)
Two pivot reports: **Stock list** and **Movement list** — any column, filter, group-by, saved views, Excel.

## 5. Permissions, scope, money

- New tab in `permission_registry.py` › store: `("reports", "Reports", REPORT)` (Manager edits; rule 17: tab exists in UI).
- `core/features/store.py`: `register_features("store", "reports", management_feature())` — per-person breakdowns
  (posted by, issued by) only with People & performance; without it the person visuals are removed.
- Money (rates, values) = existing `store › items › stock_values` feature via `money_feature=`.
- Data scope: both loaders filter by `visible_location_ids` (plant scope); admins / FULL scope see everything.
- Export goes through the framework's Excel export (`EXPORT_CAP` respected).

## 6. Files

Backend
- NEW `backend/app/modules/store/reporting.py` (~600 lines: 2 datasets, 3 pages, 2 explorer reports)
- `backend/app/core/reporting/providers.py` — add `"app.modules.store.reporting"` (1 line)
- `backend/app/core/permission_registry.py` — store `reports` tab (Manager)
- `backend/app/core/features/store.py` — management feature on the reports tab
- NEW `backend/app/tests/test_store_reporting.py` — dataset shapes, health / ABC / idle derivations, money stripped
  without stock_values, people visuals stripped without management, plant scope, date window on the movement loader

Frontend
- NEW `frontend/src/app/dashboard/store/reports/page.tsx` — `<ModuleDashboardPage module="store" nav={<StoreNav/>} … />`
- `frontend/src/components/store/StoreNav.tsx` — new group "Reports" (chart icon) before the Settings gear, `subtabKey: 'reports'`
- Role editor (`PermissionMatrixEditor`) picks the new tab up from the registry; no edit expected.

No migration. No new tables. No R&D files touched.

## 7. Build team (when the owner says build)

backend-agent (provider + tests) ∥ frontend-agent (page + nav) → integration-agent (api contract, tsc, pytest,
ruff py312) → review wave: performance-agent (movement loader window + joins), security-agent (money / people / scope
gating), reviewer-agent, uiux / qa live check on localhost (owner signs in).

## 8. Decisions needed from the owner (defaults in bold)

1. Reorder basis: **plant-level `store_item_plants` first, item-level fallback** (as the Reorder page) — ok?
2. ABC thresholds **70 / 20 / 10 by value**, hard-coded for now — ok, or a Store setting?
3. Idle-age buckets **0-90 / 91-180 / 181-365 / 365+ days** — ok?
4. Page 3 "Open PR qty" column deferred to phase 2 — ok?
5. Phase 2 datasets (batch expiry, count variance, job work overdue, GRN rejection %) — which first?
