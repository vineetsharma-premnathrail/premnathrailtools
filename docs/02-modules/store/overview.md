# Store Module — Overview

**Module:** Store (Inventory Management)
**Backend Location:** `backend/app/modules/store/`
**Frontend Location:** `frontend/src/app/dashboard/store/`
**Prepared by:** Vineet Sharma
**Last refreshed:** 7 October 2026 (against the working tree, including uncommitted Store / Quality Phase 1–2 changes)

---

# 1. Introduction

Store is PremnathRail's inventory system. It answers three questions for every item: **what do we have**, **where is it**, and **why did it change**. Its central design rule is that **every quantity change, from any module, is one row in one append-only ledger** (`store_stock_transactions`), written by one function: `post_stock_transaction()` in `services/stock_ledger.py`. The balance table (`store_stock_balances`) is a running total that this same function updates in the same transaction. Nothing else writes to it.

> **ERP why — single ledger.** SAP (MM: material documents → stock), Oracle (inventory transactions) and Tally all work this way. If each department kept its own quantities, nobody could reconcile them at year-end, and an auditor could not trace a balance back to source documents. With one ledger, any balance can be rebuilt by summing its rows, and each row names its source document (`reference_type` + `reference_number`).

Modules that post to the ledger: Store's own documents (issue, return, transfer, adjustment, manual entry, import), **P2P** (GRN receipts, PR issue-from-stock), **Quality** (inspection lots, NCR dispositions), **Production** (work orders), **Maintenance** (work-order spares), **Hydraulic** (service parts).

---

# 2. Masters

## 2.1 Item Master (`store_items`, `routes/items.py`)

| Field group | Fields | Why it exists |
|---|---|---|
| Identity | `item_code` (unique), `item_name`, `item_type`, `category`, `subcategory`, `description` | One code per material, so every document refers to the same thing |
| Units | `uom` (required, from the UOM master), `secondary_uom`, `conversion_factor` | Quantities are only comparable in one unit |
| Identification | `part_number` (always optional), `manufacturer`, `manufacturer_part_number`, `make`, `model`, `hsn_sac_code`, `material_grade`, `specification` | Matching to vendor quotations and GST (HSN) |
| Control flags | `batch_controlled`, `serial_controlled`, `expiry_controlled`, `shelf_life_days` | Traceability (flags stored; not yet enforced on postings) |
| Quality | `inspection_on_receipt`, `test_certificate_required` | Quality Phase 1: send receipts to Quality stock first; block acceptance until the MTC arrives |
| Planning | `minimum_stock`, `maximum_stock`, `reorder_level`, `safety_stock`, `reorder_quantity` | Low-stock alerts and Maintenance spares "below minimum" |
| Costing | `standard_cost`, `moving_average_cost` | Stored only — no valuation runs on postings yet (see §10) |
| Other | `status` (`active` / `inactive` / `discontinued`), `plant`, `preferred_warehouse_id`, `preferred_supplier`, photo (SharePoint), `remarks` | |

**Automatic item codes** (`service.generate_item_code`): `<TYPE PREFIX>-<CATEGORY CODE>-<NNNN>`, numbered per type + category pair, for example `MT-HYD-0001` (Material, Hydraulic & Pneumatic). The type prefix comes from the Item Type master (`MT`, `SV`, `AS`, `CN`, `TE` by default), the category code from the top-level category matched by name, and `GEN` when there is no category. On Postgres the sequence is serialised with an advisory lock, so two users can't get the same code. A user may type a code instead; a duplicate is refused with 409. `GET /store/items/next-code` previews the next code.

**Edit rules:**
- UOM is **locked once the item has stock movements**. *Why:* changing KG to NOS on an item with history would silently change the meaning of every past quantity. Create a new item instead.
- Status must be one of the three values.
- **Delete** is refused while the item is used (stock, documents, BOM, work order, design document, spare list); set it Inactive instead.

**Item types** (`store_item_types`, `routes/item_types.py`): Material, Service, Asset, Consumable, Tool & Equipment. Label and prefix are editable; the stored `value` never changes. The default type, the last type, or a type in use can't be deleted.

**Categories** (`store_item_categories`, `routes/categories.py`): self-referencing (category → subcategory). Top-level categories carry an `item_type` that filters the item form's Category dropdown, and a `code` used in the item code. Standard categories per type are seeded (for example Material: RAW, PRD, ELE, HYD, MEC, HWF, PNT, PKG). A category with subcategories or items can't be deleted. `part_code_mode` is a dead column (Part Code is always optional since 2026-10-05).

**UOM master** (`store_uoms`, `routes/uoms.py`): codes stored uppercase (`NOS`, `KG`, `MTR` …) so "Nos" and "NOS" stay one unit. A unit in use can't be deleted (rename it instead); the last unit can't be deleted. The same list feeds the P2P New PR form (`GET /p2p/requests/meta → uoms`), so a PR line's unit matches store stock.

Bulk item import: `routes/item_import.py`. Item photo upload: `routes/item_photo.py`.

## 2.2 Warehouses (stores) and bins

- **Warehouse** (`store_locations`, `routes/locations.py`): `code` (unique), `name`, `branch_id` (the **plant**), `warehouse_type`, `manager_user_id` (store in-charge — used as the return approver), `storage_type`, `inventory_type`, address, hours, `status`/`is_active`.
  - Stock can't be **received into an inactive store** (checked inside `post_stock_transaction`).
  - **Delete is blocked** while any ledger row, issue, return, adjustment, transfer, reservation, GRN, PR line, maintenance spare, production work order or hydraulic part references the store. The error lists what is holding it. *Why:* a deleted store would orphan its history. Mark it Inactive instead.
  - Branch list readable by Store users (commit `4a2a483`) so the Warehouses page loads for non-admins.
- **Bins** (`store_bins`): rack → shelf → bin hierarchy inside a warehouse (`parent_id`, `bin_type`). Ledger rows can carry a `bin_id`, but balances are kept per **item + store**, not per bin.

## 2.3 Store Settings (`routes/settings.py`, `routes/doc_types.py`)

Every list here carries **behaviour**, not just a label, so whoever adds a type also decides what it does.

| Setting | Stored in | Behaviour | Who can change |
|---|---|---|---|
| Stock Entry Types | `store_doc_types` kind `stock_entry` | `stock_effect` in/out. Seeded: Receipt, Issue, Damage / write-off. Custom types post `manual_in` / `manual_out` | Any Store user |
| Issue Types | kind `issue` | Label only (always stock out). Seeded: Production, Maintenance, Project / Site, General / Office, **Dispatch to customer** (triggers Quality's dispatch check) | Any Store user |
| Return Sources | kind `return_source` | `requires_issue` + `approver_rule`. Seeded: *Against a Material Issue* (no approval), *Other* (store in-charge approves) | Removed from the Settings UI (`f6e4aaa`); API still accepts edits |
| Return Conditions | kind `return_condition` | `stock_effect` usable/quarantine + `approver_rule`. Seeded: Good (usable, no approval), Damaged (quarantine, department head), Rejected (quarantine, specific users → falls back to the store manager) | Removed from the Settings UI; API still accepts edits |
| Issue Rules | `store_settings` keys `challan_rules`, `vendor_issue_types`, `return_date_issue_types` | Challan number mandatory for listed issue types or stores; vendor mandatory for job-work types; expected return date mandatory for listed types | Any Store user |
| Plant Access | `store_settings` key `plant_access` | Plant-wise visibility (§2.4) | **Admin only** |

- Stock entry and issue types can be **deleted only while unused**; afterwards they can only be deactivated, so old documents keep their label. The last active type of a kind can't be deactivated.
- The **Adjustment Approvers** setting was removed (`f6e4aaa`). The `adjustment_approver_ids` constant in `models/setting.py` is now dead.

## 2.4 Plant Access (`services/plant_access.py`)

When switched on, a Store user sees and posts stock only in the stores whose `branch_id` is one of their plants. This is the portal's equivalent of SAP plant-level authorisation on goods movements. Resolution order: admin → all plants; setting off → all plants; per-user override "all plants"; per-user override plant list; the plant on the user's profile; otherwise nothing.

Enforced (list filter + `ensure_location_allowed` on detail and posting) in: stock balances/transactions/manual entry/quarantine clear, material issues, returns, transfers (both ends), adjustments (the named approver still sees theirs), reservations, stock import, locations list. **Not enforced** in P2P issue-from-stock or GRN receiving (see §10).

---

# 3. The Ledger — `post_stock_transaction()`

```
post_stock_transaction(db, item_id, location_id, transaction_type, quantity>0,
                       bin_id?, batch_number?, reference_type?, reference_number?,
                       transaction_date?, remarks?, vendor_name?, created_by_id?, entry_type?)
   1. quantity must be > 0           (direction comes from the type, never the sign)
   2. inbound into an inactive store  -> refused
   3. lock (or create, inside a savepoint) the item+store balance row  (SELECT … FOR UPDATE)
   4. apply the effect to the right bucket, refusing anything that would go negative
   5. insert the immutable ledger row, flush
```

## 3.1 Stock types (Quality Phase 1, commit `d8e61ea`)

A balance row holds three physical buckets plus one earmark:

| Bucket | Column | Meaning | Can it be issued / transferred / reserved / dispatched? |
|---|---|---|---|
| **Free** | `on_hand_qty` | Usable stock | Yes — the only bucket these draw on |
| **Quality** | `quality_qty` | Received, waiting for an inspection lot's usage decision | No |
| **Blocked** | `quarantine_qty` | Rejected or damaged, waiting for an NCR disposition or a quarantine clear | No |
| Reserved | `reserved_qty` | Part of Free earmarked by a reservation | Available = Free − Reserved |

> **ERP why — stock types.** SAP keeps unrestricted, quality-inspection and blocked stock as separate stock types for the same reason: material that physically sits on the shelf but has not passed inspection must not be issued to production. Keeping Quality and Blocked **outside** `on_hand_qty` means every existing issue/transfer check enforces this automatically, with no extra code in each document. When an issue fails, the error says how much is held in Quality or Blocked, so the store keeper knows why the shelf and the screen disagree.

## 3.2 Transaction types

| Type | Effect | Posted by |
|---|---|---|
| `receipt` | → Free | GRN (store-inspected lines), manual entry |
| `issue` | Free → out (reservation-aware) | Material Issue, P2P issue-from-stock, manual entry, Maintenance/Production/Hydraulic |
| `return_in` | → Free | Material Return (usable), quarantine "release" |
| `return_out` | Free → out (reservation-aware) | Return to vendor |
| `transfer_out` / `transfer_in` | Free → out / → Free | Stock Transfer (paired) |
| `adjustment_in` / `adjustment_out` | → Free / Free → out | **Approved** Stock Adjustment only |
| `damage` | Free → out | Manual entry |
| `manual_in` / `manual_out` | → Free / Free → out (reservation-aware) | Custom Stock Entry Types |
| `quarantine_in` / `quarantine_out` | → Blocked / Blocked → out | Return with a quarantine condition / quarantine clear |
| `quality_in` | → Quality | GRN line or production output needing inspection, job-work receipt |
| `quality_release` | Quality → Free | Inspection lot accepted |
| `quality_block` | Quality → Blocked | Inspection lot rejected |
| `blocked_release` | Blocked → Free | NCR "use as is" |
| `blocked_to_quality` | Blocked → Quality | Reworked, back for re-inspection |
| `free_block` | Free → Blocked | Manual NCR on usable stock |
| `quality_hold` | Free → Quality | Stock pulled back for re-inspection |

**Reservation-aware outbound** (`issue`, `return_out`, `transfer_out`, `manual_out`) checks *available* = Free − Reserved, so stock earmarked for one job can't be handed to another. `adjustment_out` and `damage` check only Free: they record a physical fact (counted short, broken) that must be allowed even when it leaves reserved > on hand.

**Concurrency:** the balance row is row-locked before reading; the first-ever posting for an item+store is inserted inside a savepoint so a simultaneous first posting re-reads instead of failing. Multi-line documents post in sorted (store, item) order so two documents can't deadlock (`f6e4aaa`).

**Error text** always names the item and store (`f6e4aaa`), for example *"Not enough stock of 'Hex bolt M12' in Main Store — 10 on hand, 4 reserved (6 available), 8 requested. Also 5 is in Quality stock waiting for inspection…"*.

## 3.3 Reservations (`routes/stock_reservations.py`, `adjust_reserved_qty`)

```
create (RES-YYYY-NNNN) ──► active ──► fulfilled   (releases the earmark)
                             └──────► cancelled   (releases the earmark)
```

A reservation moves quantity from available to `reserved_qty`; it never writes a ledger row. Creating one fails if available stock is short. Cancel and fulfil row-lock the reservation so a double click can't release the hold twice. **Fulfil does not consume stock** — the material still has to go out through a Material Issue (see the C-24 gap in §10).

---

# 4. Documents and their status machines

All numbers are `PREFIX-YYYY-NNNN`, per year, serialised with a Postgres advisory lock (`service.py`).

| Document | Prefix | Status machine | Posts stock when |
|---|---|---|---|
| Material Issue | `MI` | none — single step | On save |
| Material Return | `MR` | `approved` (no approval needed) / `pending_approval → approved \| rejected` | On final approval (or on save if no approval is needed) |
| Stock Transfer | `ST` | none — single step | On save (paired out/in) |
| Stock Adjustment | `SA` | `pending_approval → approved \| rejected` | Only on approval |
| Stock Reservation | `RES` | `active → fulfilled \| cancelled` | Never (earmark only) |
| Manual stock entry | — (ledger row only) | none | On save |

## 4.1 Material Issue (`routes/material_issues.py`)

Store user picks store, items, quantities, issue type, department, requester, project / work order. Validations, in order:
1. Plant access on the store.
2. Issue type must be an active Issue Type (optional at API level — PR issues have none).
3. **Challan number** mandatory if the issue type or the store is listed under Issue Rules.
4. **Vendor** mandatory for job-work issue types (material going to an outside party).
5. **Expected return date** mandatory for returnable types (machining / rework), and not before the issue date.
6. **Dispatch** issue type: must name the ERP machine / order; Quality's `ensure_dispatch_allowed` checks final inspection and, where the contract needs it, an accepted third-party certificate (Quality rule 8). Otherwise 409 "Dispatch blocked by Quality".
7. Each line posts `issue` (reservation-aware, Free stock only), sorted by item id.

> **ERP why — challan / vendor / return date.** Material leaving the gate for job work needs a delivery challan for GST (rule 55 job-work challan) and must be tracked until it comes back. Making these fields conditional by type keeps the everyday shop-floor issue fast while still enforcing the paperwork where the law or the business needs it.

**PR-linked issues.** An issue created by P2P's *Issue from Stock* carries `p2p_request_id`, remarks *"Issued against P2P request …"* plus the Store Manager's mandatory comment, `requested_by` = PR requester, `project_or_work_order` = PR project. The Issues list shows the PR number (links to the PR), Requested By and Issued By; department falls back to the PR's department (`4f3ea1b`). Recent Movements tags each reference with its type (PR, GRN, Issue …).

## 4.2 Store Manager–only issue from stock (P2P path)

Issuing **PR lines** from stock is done from the PR page, not the Store Issue form, by **the Store Manager named on that PR's approval matrix** (or an admin) — see the P2P overview §5. A comment is mandatory. Any warehouse holding available stock can be picked (default: the line's Ship To, else the fullest). Partial issue splits the line: the issued part is fulfilled, the shortfall goes to procurement.

> **ERP why.** The person who physically hands over material should be the one who records it, and the Purchase team should not be able to make stock disappear to avoid an RFQ. The required comment ("handed to X at bay 3") is the issue slip's signature.

## 4.3 Material Return (`routes/material_returns.py`)

```
create ─┬─ no approval step needed ─► approved  (posts immediately)
        └─ steps needed ──────────► pending_approval ─┬─ every step approved ─► approved (posts)
                                                       └─ any step rejected ───► rejected (reason required)
```

- **Source** (`return_source`): *Against a Material Issue* requires the issue. The return must go back to **the store the issue came from**, and per item the quantity is **capped** at issued − already returned (rejected returns don't count). The source issue row is locked so two returns can't both pass the cap.
- **Condition** per line (`return_condition`): usable → `return_in` (Free); quarantine → `quarantine_in` (Blocked).
- **Approval steps** come from the source and each condition's `approver_rule`: `warehouse_manager` (store's manager), `department_head` (head, secondary head, additional heads of the department the material was issued to), `specific_users` (falls back to the store manager when none are set). Types resolving to the same people share one step. **The creator is removed from every approver list**; if nobody is left, the return is refused with instructions on who to set up. Any one user in a step decides it. Admins can act on a pending step.
- **Job-work receipt** (Quality Phase 2): usable material returning against an issue that went to an outside vendor goes to **Quality stock under a job-work inspection lot** when the item is inspection-controlled, instead of straight to Free.
- Approvers without Store access can still open the return they must decide.

> **ERP why.** A return creates stock. Without a cap and an approver, a "Good" return with no source issue would create stock from nothing — exactly the hole the ERP review flagged (P1-STO-34). Quarantine keeps damaged material physically counted but unusable until someone decides scrap, vendor return or release.

## 4.4 Quarantine clear (`POST /store/stock/quarantine/clear`)

Takes Blocked stock out as **Scrapped**, **Returned to vendor** (`quarantine_out`) or **Released to usable stock** (`quarantine_out` + `return_in`). Quantity held by an open Quality NCR can't be cleared here — only through that NCR's disposition.

## 4.5 Stock Transfer (`routes/stock_transfers.py`)

Source ≠ destination; plant access checked on both; each line posts `transfer_out` (reservation-aware) and `transfer_in` in one transaction, in global (store, item) order to avoid A→B / B→A deadlocks. Single step — no in-transit state.

## 4.6 Stock Adjustment (`routes/stock_adjustments.py`) — maker-checker

```
Store user enters counted qty per line + names an approver (≠ self, active, has Store access)
   │   system reads the LIVE balance under row lock; stores existing, actual, difference
   ▼
pending_approval  ── nothing posted; approver notified (bell + Teams)
   ├── approve  (named approver or admin; never the creator) ─► posts the STORED difference
   │                                                             as adjustment_in / adjustment_out
   └── reject   (same people; reason mandatory) ───────────────► rejected; creator notified
```

- `existing_quantity` is read server-side at count time, never taken from the client, so a difference can't be fabricated.
- On approval the **stored** difference is posted, not re-derived from today's balance — receipts and issues since the count are real and must not be wiped out.
- Duplicate item lines are refused (the same correction would post twice). The adjustment row is locked so a double click can't post twice.
- Adjustments are **no longer possible through Record Stock Entry or stock import** (`acd49f8`); those refuse `adjustment_in/out` and point to Store → Adjustments.

> **ERP why — maker-checker.** A stock adjustment is a write-off or write-on of company assets; it hits inventory value. Every ERP (SAP MI07 posting after a physical inventory document, Oracle cycle-count approval) separates the counter from the approver. The approver can be any Store user except the creator (Store Manager is not required — see §10).

## 4.7 Manual stock entry and import (`routes/stock.py`, `routes/stock_import.py`)

*Record Stock Entry* posts one ledger row typed by a Stock Entry Type: Receipt, Issue, Damage or a custom in/out type, with optional vendor (suggested from the Accounts vendor master plus earlier entries), batch, reference, date and remarks. Excel import does the same in bulk; the Stock page exports to Excel. Adjustment types are refused. No approval step (see C-09 in §10).

---

# 5. End-to-end flows touching Store

```
P2P GRN ──► GRN line ──┬─ item.inspection_on_receipt? ─ yes ─► quality_in (Quality stock) + inspection lot
                       │                                        └─ lot usage decision ─► quality_release (Free)
                       │                                                               └► quality_block (Blocked) ─► NCR
                       └─ no ─► store inspection on GRN ─► accepted qty ─► receipt (Free)

Free stock ──► Material Issue / PR issue-from-stock / WO spares ──► issue
          ──► Transfer (out/in)            ──► Reservation (earmark)
          ──► Dispatch issue ── Quality rule 8 gate ──► issue
Issued material ──► Material Return ──► return_in (Free) | quarantine_in (Blocked) | quality_in (job work)
Physical count ──► Adjustment (pending) ──► approver ──► adjustment_in / adjustment_out
Blocked ──► quarantine clear (scrap / vendor return / release) | NCR disposition
```

---

# 6. Roles and access

| Who | What they can do |
|---|---|
| Any user with the `store` app | Masters (items, categories, UOM, types, warehouses, bins, issue rules), issues, transfers, reservations, manual entries, imports, raise adjustments and returns, view stock — limited to their plants when Plant Access is on |
| Named adjustment approver (Store user ≠ creator) | Approve / reject that adjustment |
| Return approvers (store in-charge, department head, designated users) | Approve / reject their step — even without the Store app |
| Store Manager named on a PR | Issue that PR's lines from stock (P2P) |
| Admin | Everything; stands in for any approver except on their own document; only admins change Plant Access |

There is no separate Store Manager role inside Store itself — all document actions above are open to any Store user. The `is_store_manager` user flag exists but Store routes don't check it.

---

# 7. Notifications

Per the portal rule (commit `20d441d`): **Teams only for approval requests and reminders; everything else is bell-only.** `_created/_updated/_deleted` types are suppressed entirely (`19d537d`).

| Event | To | Channel |
|---|---|---|
| Adjustment awaiting approval | Named approver | Bell + **Teams** |
| Adjustment approved / rejected | Creator | Bell |
| Return awaiting approval | Every approver on every step | Bell + **Teams** |
| Return approved / rejected | Returner | Bell |
| Inspection lot created (GRN / job work) | Quality (Quality module) | per Quality rules |

No Store reminders are scheduled yet (pending adjustments/returns don't re-notify).

---

# 8. API summary (all under `/api/v1/store`)

| Area | Routes |
|---|---|
| Items | `GET/POST /items`, `GET /items/meta`, `GET /items/next-code`, `GET/PATCH/DELETE /items/{id}`, photo, import |
| Masters | `/item-types`, `/uoms`, `/categories`, `/doc-types/{kind}`, `/locations`, `/bins`, `/settings/issue-rules`, `/settings/plant-access`, `/settings/plant-access/me` |
| Stock | `GET /stock/balances`, `GET/POST /stock/transactions`, `GET /stock/transaction-types`, `GET /stock/vendor-options`, `POST /stock/quarantine/clear`, stock import/export |
| Documents | `/material-issues` (+ `/dispatch-projects`), `/material-returns` (+ `/approve`, `/reject`), `/stock-transfers`, `/stock-adjustments` (+ `/approve`, `/reject`), `/stock-reservations` (+ `/cancel`, `/fulfill`) |

---

# 9. What Store does not do

- No procurement — purchases go through [P2P](../p2p/overview.md); Store receives via the GRN.
- No inventory valuation, FIFO/moving-average costing or GL posting from stock movements (Finance uses periodic inventory — see the Finance standards decision).
- No batch / serial / expiry enforcement yet — the flags are stored only.
- No bin-level balances — bins are recorded on ledger rows only.

---

# 10. Known gaps and open controls

Status verified against the code on 7 October 2026. IDs refer to `docs/erp-review/05-summary-and-roadmap.md`.

| ID | Control | Status in code | Detail |
|---|---|---|---|
| **C-09** | Store inventory control | **Mostly closed** | Adjustments: draft → approve by a named approver ≠ creator, nothing posts until approval ✅. Returns: capped against the source issue, same-store rule, creator excluded from approvers, "Other" source needs the store in-charge ✅. Manual entry: adjustments blocked ✅, **but Receipt / Issue / Damage / custom types still post immediately by any Store user, with no source document or approver** ❌ (P1-STO-22 / P2-STO-11). The approver is any Store user, not specifically a Store Manager (the review asked for a store manager). |
| C-12 | Audit trail | Open | Store documents, masters and settings write no `audit_logs` rows; the ledger itself is the only trail. Settings (issue rules, types) can be changed by any Store user. |
| C-21 | GRN stock integrity | Partly open | GRN lines match the Item Master **by item name text**; no `item_id` on PO/GRN lines. A GRN with no store still completes without posting stock (only a response note). Double posting is fixed (GRN row lock). Item names aren't unique in the Item Master, so name matching takes the first row. |
| C-23 | Reversal | Open | Posted issues, returns, transfers, adjustments and GRNs can't be cancelled or reversed. |
| **C-24** | Reservations | **Open** | A Material Issue checks available = Free − Reserved, so it is blocked by **its own** reservation. Workaround: *fulfil* (release) the reservation first, then issue — two steps that aren't linked. |
| C-25 | Clearing fields | Not re-verified here | |
| — | Plant access | Gap | P2P issue-from-stock and GRN receiving don't check Plant Access. |
| — | Batch/serial/expiry | Gap | Flags stored, not enforced on postings. |
| — | Reminders | Gap | No reminder for pending adjustments/returns. |
| — | Store Manager role | Gap | Store routes never check `is_store_manager`; only P2P's per-PR Store Manager slot gates issue-from-stock. |

---

# 11. Related documentation

- [P2P / Procurement Overview](../p2p/overview.md) — PR stock check, issue-from-stock, GRN.
- `backend/app/modules/quality/` — inspection lots, NCR, dispatch release (Quality Phase 1–2).
- [Maintenance Overview](../maintenance/overview.md) — spares below minimum → Raise PR.
- `docs/erp-review/` — the ERP review referenced in §10.
