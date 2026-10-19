# Store — Item Master & Inventory Costing Foundation Plan

**Module:** Store (`store`), with changes in P2P (`p2p`) and readers in Accounts, Production, Maintenance, Quality
**Backend Location:** `backend/app/modules/store/` (exists)
**Spec:** `docs/MODULE_DETAILED_PLAN.md` §16 (Store & Item Master), §21 (Finance), §41 (Store settings), decision **D5** (periodic inventory). Depended on by: [Production next-phase plan](../production/next-phase-plan.md) Phase 0 / §5.2.0 / Q1, Q4, Q6; [Engineering BOM plan](../engineering/plan.md) §4.3, §5.6, Q9, Q10; [Sales plan](../sales/plan.md) §4.2, Q4; [Store overview](overview.md) §10 (C-21); [P2P overview](../p2p/overview.md) §13 (C-21).
**Prepared by:** Vineet Sharma
**Date:** 7 October 2026
**Status:** Draft plan, no code yet. Every open question in §12 has a default, so a phase can start before it is answered.

This plan builds the shared foundation that other plans assume already exists:

1. Weighted-average cost that is actually **maintained** by priced receipts.
2. `unit_cost` and `value` on **every** stock ledger row, plus a backfill for existing rows.
3. `store_item_id` (and plant) on PR, PO and GRN lines, so P2P stops matching items by name.
4. `lead_time_days` on the Item Master.
5. A decision on the item code format.

---

# 1. Purpose

Several plans need things that don't exist yet:

| Consumer | What it needs | Today |
|---|---|---|
| Production Topic 2 (costing, settlement) | Weighted average and a cost frozen on each issue row | `moving_average_cost` is **never written by the app**. Costing is recomputed at read time from today's rate. |
| Production Topic 1 (MRP), Engineering §5.6 (shortage) | Open PO quantity **per item**, purchase lead time, PO plant | PO lines carry only `item_name` / `part_code` text. No lead-time field. No plant on the PO. |
| Accounts closing stock (D5) | A real weighted-average rate per item, and quantity as of period end | It reads `moving_average_cost`, which is either typed in by hand or empty. It uses **current** quantity, not period-end quantity. It **leaves out Quality stock**. |
| Maintenance spares cost | The cost at the moment of issue | It uses standard cost first, then blends it by hand. |
| Sales (spares dispatch, FG items) | Dispatch issue valued at cost; FG items valued | No value on issue rows. |
| Store itself (C-21) | GRN posts to the right item | GRN matches by `lower(item_name)` and takes the first row. Names aren't unique. |

---

# 2. What exists today (checked 7 October 2026)

## 2.1 Cost fields and every reader

`store_items.standard_cost` and `store_items.moving_average_cost` (both `Float`, `store/models/item.py`). Both can be edited on the item form (`schemas/item.py` create/update). **No code writes `moving_average_cost`.**

| Reader | File:line | Rule it uses |
|---|---|---|
| Accounts closing-stock snapshot | `accounts/services/inventory.py:46` (untracked, Accounts upgrade) | Moving average → standard → 0 (`rate_source` none) |
| Production `item_unit_cost()` | `production/service.py:86` | **Standard first**, then moving average |
| Production BOM standard cost | `production/routes/boms.py:63` → `bom_standard_cost` | Same `item_unit_cost` |
| Production WO costing | `production/service.py` `work_order_costing()` | Issued qty × **today's** `item_unit_cost`, at read time |
| Maintenance spare cost | `maintenance/routes/work_orders.py:551` `_unit_cost`, `:633-635` blend on issue; `maintenance/service.py:485` (PM kit) | Standard first, blended by hand into `spare.unit_cost` |
| Quality NCR estimated value | `quality/services/ncr.py:66` `_estimated_value` | Moving average → standard |
| Hydraulic spare cost | `hydraulic/service.py:246` `spare_unit_cost` | Spare's own cost → standard → moving average (`hyd_spare_parts` is retired by Engineering Phase 3) |
| Frontend | `dashboard/store/[id]/page.tsx`, `types/index.ts` | Displays and edits both fields |

## 2.2 The ledger

`post_stock_transaction()` (`store/services/stock_ledger.py`, **clean in git**) is the only writer of `store_stock_balances`. It takes no price. `store_stock_transactions` (**clean**) has no cost column. Callers (non-test): Store issues, returns, transfers, adjustments, manual entry, quarantine clear, stock import; P2P GRN (`goods_receipts.py`) and issue-from-stock (`p2p_requests.py`); Quality lots and NCR; Production work orders (3 sites); Maintenance work orders (2); Hydraulic service records.

Balances have three physical buckets (Free `on_hand_qty`, Quality `quality_qty`, Blocked `quarantine_qty`) plus `reserved_qty` inside Free. The ledger refuses to make any bucket negative. Multi-line documents post in sorted **(store, item)** order to avoid deadlocks.

## 2.3 P2P lines and item matching

| Table | Item link | Plant |
|---|---|---|
| `p2p_request_items` | `item_name`, `make`, `part_code` (text), `ship_to` (text) | none |
| `p2p_purchase_order_items` | `item_name`, `make`, `part_code`, `unit`, `unit_price`, `tax_rate`. **No link back to the PR line.** | none (PO header has none either) |
| `p2p_goods_receipt_items` | `po_item_id`, `item_name` snapshot | via `p2p_goods_receipts.store_location_id` (nullable) |
| `vendor_invoice_lines` (Accounts, untracked) | `po_item_id`, `store_item_id` (from `TaxLineMixin`) | — |

There are **four different matching rules** in the code and plans today:

| Where | Rule |
|---|---|
| GRN stock posting and the Quality inspection-on-receipt check (`goods_receipts.py` `_match_store_item`) | `lower(item_name)` equal, **first row** |
| PR stock check (`p2p_requests.py:897`) | `item_name ILIKE`, plus `part_code` against `part_number` / `manufacturer_part_number` when given |
| Production MRP plan §5.1.3 | Name, then `part_code = item_code` |
| Engineering plan §5.6 | `part_code = item_code` |
| Quality vendor block (`ensure_po_allowed`) | Item name |

The 3-way match (`accounts/service.py:414` `check_three_way_match`) works on **PO totals through `po_item_id`**, not names. Names only hurt the stock posting, the Quality check and the reports. A GRN with no store still completes without posting stock (C-21).

## 2.4 Item codes

`store/service.generate_item_code`: `<TYPE PREFIX>-<CATEGORY CODE>-<NNNN>`, e.g. `MT-HYD-0001`, numbered per type + category, advisory-locked. `item_code` can be typed on create and **can't be changed afterwards** (not in `StoreItemUpdate`). **The item import ignores any `item_code` column** (`routes/item_import.py` docstring) and always generates codes. The master plan §16/§41 says the v3 import (3,159 items, 29 categories) uses `CCC-SSS-NNNN`.

## 2.5 Other facts that shape the design

- `store_items` is **audited** (`core/audit_registry.py:178`). Writing the average onto the item row through the ORM on every GRN would write an audit row and bump `updated_at` each time.
- Accounts already stores money as `NUMERIC(18,2)` and rates and quantities as `NUMERIC(18,4)` (`accounts/models/_types.py`). Store uses `Float`.
- Inter-unit stock transfers are being added by the plant-access session (uncommitted `stock_transfers.py`).
- Prod DB was found fresh on 5 Oct 2026 (users re-created), so prod ledger history is short. The backfill is small, but still check `min(users.created_at)` before running it.

---

# 3. Decisions (with ERP standard / why)

## 3.1 Valuation method: weighted (moving) average, company-wide, maintained in posting order

> **ERP standard / why — weighted average vs FIFO vs standard cost.**
> - **Standard cost** fixes a planned rate. Every receipt at a different price creates a *price variance* that must be posted somewhere. That only makes sense with perpetual inventory and variance GL accounts (SAP price control "S"). D5 rules out perpetual postings. So standard cost stays as a **planning yardstick** (BOM estimates, Production variance analysis), not as the stock value.
> - **FIFO** values stock at the latest purchase layers. It needs a layer table (each receipt's remaining qty), and every issue, return and vendor return must consume and restore specific layers. It is accurate, but heavy. It also makes the cost of the same bolt issued on the same day depend on which layer was consumed.
> - **Weighted (moving) average** keeps one rate per item. It is updated on each priced receipt and used unchanged for every issue until the next receipt. AS-2 / Ind AS 2 allow FIFO or weighted average (LIFO is prohibited). Tally's default is average cost. SAP's price control "V" works this way. D5 and §41 already chose it.
>
> **Moving, not periodic, average.** A periodic average (recomputed once at month end) would leave every issue during the month without a cost until month end. Production needs the cost *at the moment of issue*.

- **Scope: one average per item for the whole company**, not per plant. Reasons: one legal entity and one balance sheet; the closing-stock entry is company-level; inter-unit transfers then stay value-neutral; and Production Q6 already defaults to company-wide. SAP allows either the plant or the company code as the valuation area. Changing to per-plant later is a new key column on the valuation table plus a re-seed. No ledger change is needed, because every row already carries its own value.
- **Order:** the average follows **posting order** (ledger id), not `transaction_date`. A back-dated GRN doesn't recost issues already posted. This is standard moving-average behaviour. The alternative (re-running history on every back-dated entry) would change last month's frozen costs.

## 3.2 The ledger carries value

> **ERP standard / why — value on every movement.** A material document in SAP carries quantity **and** value. Without that, "what did WO-0031 consume?" can only be answered by multiplying by today's rate, and that answer changes every time a GRN arrives (Production §5.2.0). With value stored on the row:
> - cost is frozen at the moment of the transaction;
> - closing stock as of any date is a sum over rows;
> - the stock card shows value movements an auditor can tie to documents;
> - the item's total value can be rebuilt from the ledger, just as the quantity can be today.

## 3.3 Items are referenced by id, never by name

> **ERP standard / why — item id, not name.** A name is a description. It is not unique (the Item Master allows duplicates), and people retype it with different spaces, case and abbreviations ("Hex bolt M12x50" vs "HEX BOLT M12 X 50"). Matching text picks the *first* similar row, so a GRN can post stock to the wrong item without any error. Every ERP carries the material number on the PR line, copies it to the PO line, and copies it again to the GR line. The text is only a description snapshot. Free-text lines are allowed only for non-stock purchases (services, one-off items), and those are flagged as such (master plan §14 rule 5, R6).

## 3.4 Separate valuation table, not columns on `store_items`

The running quantity and value live in a new `store_item_valuations` table, one row per item. Reasons:
- Posting must row-lock the valuation. Locking the audited, user-edited Item Master row on every movement would clash with item edits and flood the audit log.
- The value is kept as a **total** (`value`), and the rate is derived as `value ÷ qty`. Storing only a rounded rate drifts by paise on every receipt. Storing the total doesn't.

`store_items.moving_average_cost` stays as a **read-only mirror** for existing readers. It is written by a Core `UPDATE` that keeps `updated_at` as it is and bypasses the ORM audit hook. It is removed from the create/update schemas, so nobody can type it any more. Readers move to `valuation.current_rate()` over time (§7). The column is dropped once nothing reads it.

---

# 4. Data model

All new tables use `TimestampMixin`. Money is `NUMERIC(18,2)`; rates and quantities are `NUMERIC(18,4)`, matching Accounts' `_types.py` (reuse the same type objects, or define `store/models/_types.py` with identical definitions).

## 4.1 `StoreItemValuation` (`store_item_valuations`) — new

| Field | Notes |
|---|---|
| `item_id` | PK and FK `store_items.id` |
| `qty` | Σ of on hand + quality + blocked over all stores. Must always equal the balances (invariant, §9). Reserved is part of on hand and isn't counted twice. |
| `value` | Total value of that quantity, 2 dp. **This is the source of truth.** |
| `avg_rate` | `value ÷ qty` (4 dp) when qty > 0. When qty = 0 it keeps the last rate, which is used for zero-stock valuation and display. |
| `last_receipt_rate`, `last_receipt_date`, `last_receipt_ref` | Last priced external receipt. Engineering §34's "last PO rate" cost basis reads it. |
| `unvalued_qty` | Quantity that came in with no rate at all (legacy only, §6). Shown as a warning count in Accounts and Store. |
| `updated_at` | |

Not audited row by row: the ledger and the events table are the trail.

## 4.2 `StoreValuationEvent` (`store_valuation_events`) — new, value-only changes

A ledger row requires quantity > 0. Some changes alter value without moving quantity:

| `event_type` | Raised by |
|---|---|
| `cutover_opening` | The cut-over / backfill (§6). Sets qty and value per item at the cut-over. |
| `rounding_writeoff` | The engine, when qty reaches 0 but a residual value remains (should not happen after the "last unit takes the rest" rule; kept as a safety net). |
| `revaluation` | A manual correction of a wrong rate (maker ≠ checker, Store head + Finance Manager). Later phase (§10 Phase F). |
| `wo_settlement` | Production Phase 4 FG revaluation (Production §5.2.4). |
| `invoice_price_difference` | Reserved. Not used by default (§12 Q4). |

Fields: `item_id`, `event_type`, `value_delta` (signed), `qty_basis`, `rate_before`, `rate_after`, `reference_type`, `reference_number`, `reason` (required), `created_by_id`, `approved_by_id`, `event_date`. Audited with `register_audited`.

## 4.3 `store_stock_transactions` — new columns (all nullable, so legacy rows stay valid)

| Column | Type | Meaning |
|---|---|---|
| `unit_cost` | NUMERIC(18,4) | Rate this row moved at |
| `value` | NUMERIC(18,2) | Always positive, like `quantity`. Direction comes from the type, as it does for quantity. |
| `cost_source` | String(20) | `po_rate`, `average`, `standard`, `manual_rate`, `opening`, `issue_rate` (return at original issue cost), `grn_rate` (vendor return), `provisional` (Production FG), `unpriced_po`, `backfill`, `none` |
| `valuation_qty_after`, `valuation_value_after` | NUMERIC | Company totals for the item after this row. They feed the stock card and an integrity check. |

## 4.4 `store_items` — new columns

| Column | Notes |
|---|---|
| `lead_time_days` | Nullable int, ≥ 0 and ≤ 730. **Purchase** lead time in **calendar** days (supplier days, not our working days). This is the one column that Production §4.6 and Engineering §4.3 both plan. **This plan adds it (Phase A).** The other sessions reuse it and must not add it again. |
| `legacy_code` | Nullable String(50), unique when set, searchable. Holds the v3 / Tally code (§5.5). |

`moving_average_cost` becomes read-only (§3.4). `standard_cost` stays editable and audited.

## 4.5 P2P columns (owned by P2P; built in this plan's Phase E with the P2P session's agreement)

| Table | Column | Notes |
|---|---|---|
| `p2p_requests` | `branch_id` (FK `branches`) | Requesting / receiving plant. Required for new PRs; defaults to the requester's plant. Legacy rows stay null. |
| `p2p_request_items` | `store_item_id` (FK, indexed), `is_non_stock` (bool, default false), `ship_to_location_id` (FK `store_locations`, optional) | `ship_to` text is kept as a printed snapshot. |
| `p2p_purchase_orders` | `branch_id` | Copied from the PR |
| `p2p_purchase_order_items` | `store_item_id`, `p2p_request_item_id` (FK, **new link back to the PR line**), `is_non_stock` | |
| `p2p_goods_receipt_items` | `store_item_id` | Snapshot copied from the PO line when the GRN is created |
| all three line tables | `item_link_source` | `user`, `migration_auto`, `migration_manual`. Used for the migration audit and for rollback. |

Line-level plant is the ship-to store (its `branch_id`). The header `branch_id` is the default for it and is what MRP filters on (Production Q4).

---

# 5. Workflows

## 5.1 The valuation engine (inside `post_stock_transaction`)

New optional keyword arguments: `unit_cost: float | None`, `cost_source: str | None`, `value: float | None` (the exact value for the paired "in" row of a transfer). The function returns the ledger row as today, now with `unit_cost` and `value` filled in. Callers that pass nothing still work: inbound rows then go in at the current average.

```
post_stock_transaction(...):
  1. existing checks (qty > 0, inactive store)
  2. lock store_item_valuations[item] FOR UPDATE   (create inside a savepoint if missing)
  3. lock the balance row (as today), apply the bucket effect (as today)
  4. classify the type by STORE_STOCK_TYPE_EFFECT:
       external in   (from None)      receipt, quality_in, return_in, adjustment_in, manual_in, quarantine_in, transfer_in*
       external out  (to None)        issue, return_out, adjustment_out, damage, manual_out, quarantine_out, transfer_out*
       internal      (both buckets)   quality_release, quality_block, blocked_release, blocked_to_quality,
                                       free_block, quality_hold  → value-neutral
     *transfers are external per store, but neutral company-wide (paired, §5.1.3)
  5. compute unit_cost / value, update valuation qty / value / avg, write cost columns + "after" totals
```

**Lock order.** Valuation (item) first, then balance (item, store). Multi-line documents change their sort key from (store, item) to **(item, store)**, through one shared helper `ledger_sort_key()`. With the old order, two documents can each hold one item's valuation lock while waiting for the other's, and deadlock. Sorting by item first gives every document the same global lock order.

### 5.1.1 Formula

Let Q and V be the item's valuation quantity and value before the row, and q the row quantity.

**Priced inbound** at rate r:
```
value_in = round(q × r, 2)
V' = V + value_in      Q' = Q + q      avg' = V' ÷ Q'
```

**Outbound, and unpriced inbound,** at the current average:
```
avg = V ÷ Q   (full precision, never the rounded avg_rate)
if Q − q ≤ 1e-9:  value_out = V                 ← the last unit takes the remaining value, so V ends at exactly 0
else:             value_out = round(q × avg, 2)
V' = V − value_out     Q' = Q − q     avg' unchanged (except for rounding)
```

**Worked example.** Stock is 10 @ ₹100 (V = 1,000).
- GRN of 5 @ ₹120: V = 1,600, Q = 15, average ₹106.6667.
- Issue of 4: value = round(4 × 106.6667) = ₹426.67. Now V = 1,173.33, Q = 11. The issue row carries ₹106.6667 / ₹426.67.
- Issue of 11: this is the last stock, so value = ₹1,173.33, and V = 0, Q = 0. The average stays at ₹106.6667 as the last rate.

This is exactly Production's Phase 0 exit test (§10).

**Rounding:** `unit_cost` 4 dp, `value` 2 dp, quantities 4 dp. Every computation uses V and Q. The displayed rate is derived from them and never fed back in.

### 5.1.2 Edge cases

| Case | Rule |
|---|---|
| Q = 0, V = 0, priced receipt | avg = r |
| Q = 0, V ≠ 0 (residual, should not happen) | Write a `rounding_writeoff` event for −V, set V = 0, then apply the receipt |
| Q = 0, unpriced inbound | Use the last `avg_rate`. If there is none, use `standard_cost`. If there is none, and the caller is a **user document** (manual receipt, opening stock, adjustment-in), **refuse**: *"'Hex bolt M12' has no average or standard cost yet, so this receipt needs a rate. Enter the rate per NOS, or set a standard cost in Store → Items."* If the caller is a **system document** (legacy unpriced PO, Production FG receipt before Production Phase 4), post with `cost_source = none`, add q to `unvalued_qty` and show it in the warning count. |
| Negative stock | Can't happen: the ledger refuses every negative bucket. The §41 setting "Allow negative stock" stays **off and locked** while weighted average is on. Average cost is undefined on negative quantity, and every ERP that allows it needs price-difference postings to clean up afterwards. |
| Q > 0 but V = 0 (legacy unvalued stock) | A priced receipt would understate the average. Prevented by the cut-over (§6), which gives every item in stock a rate. Until then the item appears in the "unvalued" list. |
| Outbound would leave V < 0 (vendor return at a rate above the current average) | Clamp: value_out = min(q × r, V). Record the difference as a `revaluation` event with reason "vendor return above current average". |
| Rate 0 (free replacement, sample) | Allowed only with `cost_source = manual_rate` and a remark. It lowers the average, which is correct, because the goods cost nothing. |
| UOM | Rates are per **item UOM**. If a PO line is in `secondary_uom`: qty_base = qty × `conversion_factor`, and rate_base = unit_price ÷ `conversion_factor`. Any other unit mismatch is refused when the PO line is linked (§5.4). |

### 5.1.3 Rule per movement

| Movement | Ledger types | Rate | Changes the average? |
|---|---|---|---|
| GRN, store-inspected line | `receipt` (accepted qty) | PO `unit_price` **excluding GST**, discount already in the price | Yes |
| GRN, inspection-on-receipt line | `quality_in` (received qty) | PO `unit_price` excl. GST | Yes, **at receipt**. SAP also values a receipt into quality-inspection stock at GR, because it is our stock (and our liability) from the moment it is received. |
| Quality decision | `quality_release` / `quality_block` | Current average (shown only) | No (internal) |
| Rejected material returned to vendor | `quarantine_out` (NCR disposition "return to vendor" or quarantine clear "Returned to vendor"), `return_out` | The **GRN line's rate** when traceable (lot → GRN line → PO price), otherwise the average | Yes (reverse of the receipt) |
| Scrap / write-off | `quarantine_out` scrap, `damage`, `adjustment_out`, `manual_out` | Average | No |
| Material Issue, P2P issue-from-stock, WO / Maintenance / Hydraulic issue, Sales dispatch | `issue` | Average | No |
| Material Return against an issue | `return_in` / `quarantine_in` / job-work `quality_in` | **The issue row's `unit_cost`** (weighted over that issue's rows for the item) | Yes, slightly. The goods come back at what they left at, so the WO credit equals its debit. |
| Return with no source issue ("Other") | same | Average (falls back to standard; user must enter a rate if neither exists) | No |
| Transfer | `transfer_out` then `transfer_in` | out: average; in: **the same unit_cost and value as the out row** | No (V − x + x) |
| Quarantine clear "release" | `quarantine_out` + `return_in` | in = the out row's value | No |
| Adjustment in (approved count) | `adjustment_in` | Average → standard → rate on the adjustment line (required only if neither exists) | No (or yes, if a rate was entered) |
| Manual stock entry "Receipt" / custom in-type | `manual_in` | **Rate field on the form**, defaulting to the average. Required when the item has no average and no standard. | Yes, if a rate was entered |
| Opening stock (cut-over / v3 import) | `manual_in` with `entry_type = opening` | **Mandatory rate** | Yes |
| Production FG receipt | `receipt` | Production Phase 4: provisional cost. **Until then:** `standard_cost`, else average, else unvalued. | Yes |
| Production / Maintenance return | `return_in` | The issue row's cost | Yes, slightly |

> **ERP standard / why — GST out, rate at PO price.** Input GST is recovered as credit, so it isn't part of the cost of the goods (AS-2: purchase cost excludes recoverable taxes). The PO price is the agreed price. The invoice may differ within the 1% tolerance that the 3-way match allows. Under periodic inventory, the GL books purchases at the invoice amount anyway, and the stock rate only affects the closing-stock figure. So the stock rate stays at the PO price (§12 Q4).

> **ERP standard / why — internal moves are value-neutral.** Moving stock between Quality, Free and Blocked, or between two stores of the same company, doesn't change what the company owns. If these moves changed value, a simple transfer would alter the cost of an RRV.

## 5.2 Settings (`register_module_settings("store", ...)`, values only, D8)

| Key | Default | Notes |
|---|---|---|
| `valuation_enabled` | **off** until the Phase D cut-over, then on | **Off** = the engine writes no cost columns (the rollback switch, §11). |
| `valuation_cutover_date` | the date of the cut-over run | Shown on reports: "values before this date are cut-over estimates" |
| `require_rate_on_manual_receipt` | on | §5.1.2 |
| `allow_negative_stock` | off (locked while valuation is on) | §41 |

There is no "valuation method" switch. The method is code (D8). A FIFO switch would need a different data model.

## 5.3 Lead time on items

- Item form: "Purchase lead time (days)" in the Planning group, with help text "Calendar days from PO to goods in store. Used by MRP and the Engineering long-lead list."
- Import/export column `lead_time_days`. Store list filter "No lead time" (MRP flags these as *assumed*).
- Phase F report: **actual vs master lead time** per item (PO date → first GRN date, last 12 months, median), with a one-click "use 21 days" suggestion that the user confirms. Not automatic, because one late vendor shouldn't silently change planning.

## 5.4 Item id on PR → PO → GRN

```
New PR line: item picker (searchable select over the Item Master: code · name · make · part no. · UOM)
   ├─ picked     → store_item_id, item_name/unit/make filled from the item (still editable as description)
   ├─ "Non-stock / service" ticked → is_non_stock = true, free text (JOB category defaults to this)
   └─ neither    → allowed at submit, flagged "No item code" (Store is notified to create or link one)
Pre-fills (Maintenance spares, MRP, Engineering shortage) pass store_item_id in sessionStorage items → no matching
PR stock check / issue-from-stock: uses store_item_id when set; legacy name match only for unlinked lines
PO draft: lines copy store_item_id, is_non_stock, and p2p_request_item_id from the PR line
PO submit for approval: REFUSED while any line is neither linked nor non-stock:
   "Line 3 'Hex bolt M12' has no Item Master code. Pick the item (Store → Items has 2 similar: MT-HWF-0012, MT-HWF-0040)
    or mark it Non-stock if it isn't kept in store."
   UOM check: the PO unit must be the item UOM (or its secondary UOM with a conversion factor)
GRN create: lines copy store_item_id. A store location is REQUIRED when any line is a stock item (closes C-21 gap 2)
   Legacy open PO line without an id: the GRN form shows "Link item" for that line (Store user picks; written to
   PO line and GRN line, item_link_source = user, audited). No name matching at posting time.
GRN posting / Quality lot: by store_item_id. Non-stock lines post nothing and say so.
Invoice lines: store_item_id defaults from po_item_id → PO line (Accounts' purchase/sales impact report groups by item)
```

> **ERP standard / why — block at PO submit, not at PR.** A requester often doesn't know the code, and SAP allows a text-only PR item for exactly this reason. The PO is the commitment that turns into a GRN and stock. Requiring the code there gives Store time to create it, and still guarantees that no stock line reaches receiving without an id.

**3-way match:** no logic change is needed, because it already works through `po_item_id`. Line-level matching by item becomes possible, and is an Accounts decision.
**Quality vendor block** (`ensure_po_allowed`): later moves to item ids. That is Quality's change, and it has a name fallback for legacy lines.

## 5.5 Item code format: keep `<TYPE>-<CAT>-<NNNN>`, add `legacy_code`

| Option | For | Against |
|---|---|---|
| **A. Keep the generator; store the v3 code in `legacy_code`** (recommended) | No second scheme in the database. Codes already issued stay valid. The type prefix tells Store/Purchase at a glance whether it is material, consumable, tool or service. Engineering, Production and Sales use ids, so nothing else is affected. | People who know v3 codes search by `legacy_code` during the transition (the item search and pickers include it) |
| B. Switch to `CCC-SSS-NNNN` | Matches the v3 sheet and the master plan text | Every existing item code changes, or two schemes live side by side. The sub-category becomes part of an identifier that must never change, so re-classifying an item would need a new code. |

> **ERP standard / why — codes are identifiers, not classification.** The material number must never change. Classification (category, sub-category, type) belongs in fields that *can* change. Semi-meaningful codes are fine to read, but nothing may parse them. The import gets an optional `legacy_code` column. The v3 sub-category maps to the existing subcategory field, and the v3 category maps to the category master's `code`. The 29 v3 categories need a mapping table in the import dry run (category name → category code).

---

# 6. Data migration, backfill and cut-over

Alembic only **adds columns and tables** (nullable, idempotent inspector checks, chained off the current `alembic heads`, which is `b3d8f1a6c2e9` today and will move). Data is changed by **admin-triggered, idempotent data migrations** with dry-run Excel reports, following the Engineering §12 pattern. **Before any apply on prod:** take a dump to `D:\PremnathrailBackup\dumps` and check `min(users.created_at)` (prod was found reset on 5 Oct).

## 6.1 Ledger backfill and cut-over valuation (`POST /store/admin/valuation/backfill?dry_run=true`)

1. **Replay** every ledger row in id order per item, applying §5.1 to rows posted before the cut-over:
   - GRN `receipt` / `quality_in` rows: rate = the PO line price, found through `reference_number` (GRN no.) → GRN line for that item → `po_item.unit_price`. Source `backfill`.
   - Return-to-vendor rows: that GRN's rate.
   - Every other inbound row: the running average. If there is none yet, use the **seed rate** (below).
   - Outbound and internal rows: the running average.
2. **Seed rate** for an item whose first inbound row has no price, in this order: the last priced GRN for the item → the typed `moving_average_cost` → `standard_cost` → the Finance rate sheet (the dry-run Excel has a "rate" column to fill and re-import with `?rates=file`).
3. The dry run returns per item: replayed qty, value and average; the replayed qty vs the balance qty (**must be equal**, otherwise the item is listed as a ledger/balance mismatch to fix first); rows that used a seed rate; items with no rate at all.
4. **Apply** writes the cost columns on the old rows (`cost_source = backfill`), creates the `store_item_valuations` rows and one `cutover_opening` event per item, sets `valuation_cutover_date`, and switches `valuation_enabled` on. Idempotent: a re-run with no change writes nothing. A re-run after a rate correction rewrites only `backfill` rows.
5. **Rule:** replayed values are estimates. Reports mark rows before the cut-over date as "cut-over values". Closed WOs are not recosted (Production has no frozen settlements yet, so nothing is invalidated).

Because prod history is a few days long, the replay is small. The same tool also works for a **fresh-start cut-over** (no replay, opening stock imported with rates on the cut-over date), which is the master plan §16 step 5 route for the v3 go-live.

## 6.2 Opening stock

Stock Import gets an **"Opening stock"** mode: item (code or legacy code), store, qty, **rate (mandatory)**, batch, one cut-off date for the file. Each row posts `manual_in` with `entry_type = opening`. Only admins and the Store head can use this mode. An item+store that already has movements before the cut-off is refused, so opening stock can't be double-loaded.

## 6.3 P2P item links (`POST /store/admin/item-link/p2p?dry_run=true`)

Scope: **open** lines first. These are PR lines not yet converted or cancelled, PO lines on POs that aren't fulfilled or cancelled, and draft GRN lines. Closed history is linked when the match is certain and otherwise left unlinked, because nobody posts against it any more.

Matching, in order. Only a **unique** hit is accepted:
1. `part_code` = `item_code` or `legacy_code` (case and space insensitive)
2. `part_code` = `part_number` / `manufacturer_part_number`, and `make` equal (or blank on one side)
3. normalised `item_name` (lower case, collapsed spaces, punctuation stripped) equal, and `make` equal when both are set
4. otherwise unmatched. The Excel lists the top 3 candidates by name similarity and has a blank "chosen item code" column. Store fills it in and re-imports it (`?mapping=file`).

Then: PO lines get `p2p_request_item_id` by matching the same PR + name + part code (unique), and inherit the PR line's item. GRN lines inherit from their PO line. **Conflict report:** GRN rows already posted to the ledger whose name-matched item differs from the mapped item are listed. They are **not** auto-corrected. Store fixes them with an approved adjustment pair, because the ledger is append-only.

---

# 7. Who reads what afterwards

| Consumer | Reads | Change (owner) |
|---|---|---|
| **Accounts closing stock** (`accounts/services/inventory.py`) | `store_stock_snapshot(as_of)`: current figures from `store_item_valuations`; period-end figures as Σ signed ledger qty / value with `transaction_date ≤ date` (external rows only) + valuation events ≤ date | 1. **Bug fix: include `quality_qty`** (received stock under inspection is ours, and is excluded today). 2. Use quantity and value as of `valuation_date`, not "now". 3. `rate_source` = `moving_average` except for unvalued items. The draft stays editable for physical-count corrections. (Accounts session, Phase F) |
| Accounts invoice lines | `store_item_id` defaulted from the PO line | Accounts, Phase E/F |
| **Production** costing (Topic 2) | Actual material = Σ ledger issue `value` − Σ return `value` for the WO. Estimate = `standard_cost`, falling back to the current average. FG receipt passes `unit_cost` (provisional). Settlement writes a `wo_settlement` event. | Production Phase 4. `item_unit_cost()` stays standard-first for **estimates only**. |
| **Production MRP** (Topic 1) | `lead_time_days`; open PO qty by `store_item_id`; PO `branch_id` / ship-to store for plant runs | Production Phase 1 (name matching only for unlinked legacy lines) |
| **Engineering** shortage / long-lead / cost roll-up | `store_item_id` on PR and PO lines; `lead_time_days`; `last_receipt_rate` and `avg_rate` | Engineering Phase 2/3 |
| **Maintenance** spares | `spare.unit_cost` = the value-weighted cost of the ledger issue rows (from the row `post_stock_transaction` returns), replacing the standard-first `_unit_cost` blend; plan estimate = current average | Maintenance session, small change in `routes/work_orders.py` and `service.py` |
| **Quality** NCR value | Value of the `quality_block` / `free_block` row; estimate = current average | Quality, optional |
| **Sales** | Spares / RRV dispatch issue `value` = cost of goods for margin reports; FG item value from Production | Sales Phase 2+ |
| **Store** | Value column on Stock; stock valuation report (item / category / store, as of date); stock card with value; "unvalued" and "no lead time" lists | This plan, Phase F |

Viewing values: Store and Accounts users. Production, Maintenance, Engineering and Sales see the costs on their own documents. A `store:valuation` permission subtab gates the valuation report and the revaluation action.

---

# 8. API and frontend (summary)

**Backend**
- `store/services/valuation.py` (new): `apply_valuation()` (called by the ledger), `current_rate(db, item_id)`, `stock_value(db, as_of)`, `stock_card(db, item_id, …)`, `ledger_sort_key()`.
- `store/routes/valuation.py` (new): `GET /store/valuation` (report, Excel), `GET /store/items/{id}/stock-card`, `POST /store/admin/valuation/backfill`, Phase F `POST /store/valuation/revaluations` (+ approve / reject).
- `store/routes/item_link.py` (new): the P2P link migration endpoints (§6.3).
- Changed: `stock_ledger.py`; issue / return / transfer / adjustment / stock / stock_import routes (sort key, rates, cost on response); `items.py` + schemas (`lead_time_days`, `legacy_code`, average read-only); P2P `p2p_requests.py`, `rfq.py`, `goods_receipts.py`, schemas; `quality/services/lots.py` (`create_lot` / `create_lot_for_grn_line` accept `unit_cost` for `quality_in`).

**Frontend**
- Item form: lead time, legacy code, average shown read-only ("System weighted average · last receipt ₹120 on 06-10-2026").
- Stock page: value column. New Valuation page and Stock Card tab.
- New PR form: item picker per line plus a "Non-stock" checkbox (`SearchableSelect`, per the UI conventions skill).
- PO draft: "No item code" badge and link picker. GRN form: "Link item" for legacy lines.
- Manual stock entry and Stock Import: rate field and Opening mode.
- `lib/api.ts`, `types/index.ts` additions; Store and P2P tour configs updated (the P2P form changes; the pre-push tour rule applies to CRM only, but Store/P2P tours exist and should follow).

---

# 9. Tests (`backend/app/tests/test_store_valuation.py`, `test_p2p_item_link.py`)

- **Formula:** the §5.1.1 example exactly (106.6667 / 426.67 / last issue takes 1,173.33 / V = 0).
- **Priced GRN** on both paths (store-inspected `receipt`; `quality_in` + lot release) moves the average once. Release and block don't change it.
- **Vendor return** of rejected material at the GRN rate; clamp case writes a `revaluation` event.
- **Material Return** against an issue comes back at the issue cost; a WO's net material value = Σ issues − Σ returns.
- **Transfer** S1 → S2 leaves V unchanged, including transferring the entire stock (Q passes through 0).
- **Quarantine release** pair is value-neutral.
- **Zero stock:** receipt after Q = 0 takes the new rate; residual write-off path.
- **Unpriced user receipt** with no average and no standard is refused with the real message. System receipt is unvalued and counted.
- **Invariant:** after every test, `valuation.qty` = Σ (on hand + quality + blocked) over all stores, and `valuation.value` = Σ signed external ledger values + Σ events.
- **Concurrency:** two multi-line documents with crossed items and stores don't deadlock (sort key); two simultaneous GRNs for one item give the same average as running them in sequence.
- **Mirror:** `store_items.moving_average_cost` follows the average, no `audit_logs` row is written, `updated_at` unchanged.
- **Back-dated GRN** doesn't change earlier issue rows.
- **UOM:** secondary-UOM PO line converts qty and rate; a mismatched unit is refused when the PO line is linked.
- **Backfill:** dry run is read-only; apply is idempotent; mismatch detection; seed-rate order.
- **P2P:** picker id carried PR → PO → GRN; PO submit blocked on an unlinked stock line, allowed for non-stock; GRN without a store refused when there are stock lines; legacy "Link item"; link migration rules 1–4 with ambiguous names listed, not guessed; conflict report.
- **Accounts:** as-of-date closing stock includes Quality stock and ignores movements after the date.
- **Lead time:** validation 0–730; import/export round trip.
- Existing suites stay green: `test_cov_production_*`, `test_maintenance*`, `test_quality_phase*`, `test_accounts_finance`, `test_cov_store_open_*`, `test_cov_controls_p2p`.

---

# 10. Phased delivery and sequencing with parallel sessions

## 10.1 Who is editing what right now (`git status`, 7 October 2026: 716 changed paths)

| Area | State | Owner session | Effect on this plan |
|---|---|---|---|
| `store/services/stock_ledger.py`, `store/models/item.py`, `store/models/stock_transaction.py`, `store/models/stock_balance.py`, `store/service.py` | **Clean** | — | Phases A and B can start now. |
| `store/routes/material_issues.py`, `material_returns.py`, `stock.py`, `stock_adjustments.py`, `stock_import.py`, `stock_reservations.py`, `stock_transfers.py`, `locations.py`, `settings.py`, `uoms.py`, `store/models/setting.py`; untracked `store/services/plant_access.py`, `test_store_plant_access.py`, `dashboard/store/settings/plant-access/` | **Modified / untracked** | Store plant-access session | Phase C edits the same routes (sort key, rates). **Wait until that session commits**, then re-read. |
| `p2p/models/p2p_request.py`, `purchase_order.py`, `p2p/routes/goods_receipts.py`, `p2p_requests.py`, `rfq.py`, `purchase_orders.py`, `mis.py`, `p2p/schemas/*` | **Modified** | MD → Partner rename (+ Quality vendor-block hook) | Phases C (GRN rate) and E (item id) wait for the commit. |
| Whole Accounts module incl. **untracked** `accounts/services/inventory.py`, `models/inventory_valuation.py`, `routes/inventory_accounting.py`, `models/tax_line.py`, migration `a8c3e5f7b9d1_accounts_standards_upgrade.py` | **Untracked / modified** | Accounts standards upgrade | Phase F's Accounts reader change waits for it to be committed and deployed. Hand the §7 change to that session, or do it right after with its agreement. |
| `quality/services/lots.py`, `ncr.py`, `first_article.py`, `settings.py` …; migration `5d8a3c6e2f71_quality_phase3_improvement.py` | **Modified / untracked** | Quality Phase 3 | Phase C threads `unit_cost` through `create_lot` for GRN `quality_in`, and the GRN rate for vendor-return dispositions. Agree the 2–3 line hunk, or land it after Phase 3 commits. |
| `maintenance/routes/work_orders.py`, `maintenance/service.py` (+ many untracked) | **Modified** | Maintenance Phase 2 | Phase F reader switch after that commit. |
| `production/routes/rrv_builds.py` | Modified | Word-documents session | No overlap. Production Phase 4 is the consumer. |
| `core/permission_registry.py`, `core/audit_registry.py`, `main.py`, `alembic/env.py`; `core/module_visibility.py` staged as deleted | Modified by several sessions | Shared | Re-read just before editing; anchored inserts; commit only this session's hunks. |
| `alembic/versions/` | 15 untracked migrations; head `b3d8f1a6c2e9_module_settings.py` (untracked) | Settings framework and others | Run `alembic heads` right before writing `down_revision`. The settings framework must be committed before §5.2's settings are declared (until then, module constants with the same defaults). |

## 10.2 Build order

**Phase A — Schema and item fields (now; clean files only).**
- Migration: `store_item_valuations`, `store_valuation_events`, ledger cost columns, `store_items.lead_time_days`, `legacy_code`.
- Models (imported in **both** `alembic/env.py` and `main.py`), `register_audited` for events.
- Item form, schema and import/export for lead time and legacy code; `moving_average_cost` made read-only in the API.

*Exit:* the migration upgrades and downgrades cleanly on a copy of prod; lead time is saved, imported and exported; nothing posts differently.

**Phase B — Valuation engine (now; `stock_ledger.py` is clean).**
- `services/valuation.py`, engine inside `post_stock_transaction` behind `valuation_enabled` (off), `ledger_sort_key()`, the mirror write. All §9 engine tests, run with the flag on in tests.

*Exit:* the §5.1.1 example and the invariant pass in tests. With the flag off, existing suites are unchanged.

**Phase C — Callers pass prices (after the plant-access, P2P rename and Quality Phase 3 commits).**
- GRN rate on both paths; returns at issue cost; vendor returns at GRN rate; transfer and release pairs; manual-entry rate field; Opening stock import mode; sort key adopted by every multi-line document.

*Exit:* this is **Production's Phase 0 test.** A GRN at ₹120 on stock at ₹100 moves the average correctly, and the next issue row carries the rate. A transfer of all stock leaves value unchanged.

**Phase D — Cut-over (after C, on staging then prod).**
- Backfill dry run → review mismatches and rates with Store and Finance → dump → apply → `valuation_enabled` on.

*Exit:* every item in stock has a value. The invariant report is clean. Accounts' stock-value page (still the old reader) shows real averages through the mirror.

**Phase E — Item id on P2P lines (after the P2P rename commit; can run in parallel with C/D).**
- P2P columns, PR picker and non-stock flag, prefill `store_item_id`, PO copy + submit guard + UOM check, GRN by id, store required for stock lines, "Link item", the link migration (§6.3) for open lines.

*Exit:* a new PR → PO → GRN posts to the picked item with **no name lookup** (verified by two Item Master rows with the same name). Every open PO line is linked, or explicitly non-stock. MRP and Engineering can count open PO quantity by item id.

**Phase F — Readers and reports.**
- Store valuation report and stock card.
- Accounts as-of-date snapshot including Quality stock (with the Accounts session).
- Maintenance spare cost from ledger rows; lead-time actual vs master report; revaluation document (maker ≠ checker); drop the `moving_average_cost` mirror once all readers have moved.

*Exit:* the closing-stock draft for September equals the Store valuation report as of 30-Sep, including Quality stock. A Maintenance job's spares cost equals Σ its ledger issue values.

Phases A and B unblock Production Topic 2 design. C and D unblock Production Phase 4. E unblocks exact MRP and Engineering netting (they start earlier on name/code matching, as their plans already allow).

---

# 11. Rollback

| Layer | How to undo |
|---|---|
| Schema | All additive and nullable. Downgrade drops the new tables and columns. No existing column is altered (`moving_average_cost` stays `Float`). |
| Engine | `valuation_enabled = off`: postings go back to quantity-only, and readers keep the last mirrored average. Nothing else changes. |
| Backfill | Writes only `backfill`-sourced cost columns, valuation rows and `cutover_opening` events. The rollback endpoint nulls `backfill` rows and deletes cut-over events and valuation rows. Last resort: restore the pre-apply dump. |
| P2P links | Only null `store_item_id` values are written, tagged `migration_auto` / `migration_manual`. The rollback endpoint nulls those tags. The `user` links stay. |
| Code | Each phase is one commit straight to `main` (repo rule), so it can be reverted alone. Phase C/E behaviour keeps the legacy name fallback for unlinked rows during one release. |

---

# 12. Open questions (default in **bold**; work proceeds on the default)

1. **Per-plant or company-wide average?** **Company-wide.** If the plants are in different states (separate GSTINs), inter-unit transfers are taxable supplies needing a tax invoice. That is a Finance/GST question, separate from valuation.
2. **GST in the rate?** **Excluded always.** Items whose input credit is blocked under s.17(5) would need GST added to cost. Flag them later if Finance identifies any.
3. **Freight, packing, insurance (landed cost)?** AS-2 includes them in cost, but PO lines have no such fields. **Not in this plan.** Finance can apply them later as a value-only revaluation, or P2P can add PO charge lines apportioned by value.
4. **Re-average when the invoice price differs from the PO price?** **No.** Report the differences only. Within the 1% tolerance it is immaterial, and larger variances already need Finance approval.
5. **Cut-over rates for existing stock?** **Last priced GRN → typed average → standard → Finance sheet.** Who signs off the sheet? Default: Store head + Finance Manager.
6. **Item code format.** **Keep `<TYPE>-<CAT>-<NNNN>`, add `legacy_code` for v3/Tally codes.** Has the v3 sheet already been loaded anywhere? If it went through today's import, its codes were regenerated and only the legacy code column can bring them back.
7. **PR lines without an item code.** **Allowed at PR submit, blocked at PO submit unless marked non-stock.** Should the JOB category always be non-stock? Default: yes, by default, and the buyer can untick it.
8. **Plant on PR/PO.** **Header `branch_id` required for new PRs (defaults to the requester's plant), with an optional ship-to store per line.** Can a GRN land in another plant's store than the PO's? **Yes, with a warning** (inter-unit deliveries happen).
9. **Historical P2P lines.** **Link open lines (mandatory) and certain matches only for closed history.** The rest stay unlinked.
10. **Who may see stock values?** **Store and Accounts users, with a `store:valuation` subtab for the valuation report and revaluation.**
11. **Who may edit `standard_cost`?** **Any Store user (as today, audited).** Recommendation: restrict it to the Store head and Finance once Production variance reports use it.
12. **Revaluation (correcting a wrong rate).** **Phase F, maker ≠ checker: Store head raises, Finance Manager approves.** Above ₹10,000 it needs Finance, as in the §41 adjustment limit.
13. **Back-dated GRNs.** **Valued in posting order; no recalculation of later issues.**
14. **Lead time unit.** **Calendar days, purchase only.** Manufacturing lead time stays on the Production BOM (Production §4.6).
