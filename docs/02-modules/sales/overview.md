# Sales Module — Overview

**Module:** Sales (order book, delivery schedule, LD tracking)
**App key:** `sales`
**Backend Location:** `backend/app/modules/sales/`
**Frontend Location:** `frontend/src/app/dashboard/sales/`
**Prepared by:** Vineet Sharma
**Date:** 7 October 2026
**Status:** Phase 1 (order book and delivery schedule, no money flows) is built. Phase 2 (proforma, billing, dispatch, invoicing hand-off) and Phase 3 (quotation approval, price lists, bank guarantees, LD actually deducted) are not started. This document describes what the code does today. Where Phase 1 differs from [plan.md](plan.md), the difference is called out.

Design history, the reasoning behind each field and the phase scope are in [plan.md](plan.md).

---

# 1. Purpose

The Sales module is the **contract record** between CRM (the pursuit) and execution (Production, Store, Finance). It answers four questions:

1. **What exactly did the customer order, at what price and on what terms?** This is the Sales Order (SO): customer PO / LOA, lines, LD, warranty, inspection agency, billing plan.
2. **When is each vehicle due, and which RRV build is it?** This is the delivery schedule: one row per vehicle, each with its own contractual date, current date (after DP extensions), committed date (from the build) and build link.
3. **Are we going to be late, and what will it cost?** This is the at-risk / overdue flagging and the LD calculation (accrued and forecast — computed and shown, **not posted** to Accounts).
4. **Who approved this contract and what changed since?** This is the value- and deviation-based approval chain, the amendment flow with a field-level diff, and the audited timeline.

It does **not** raise invoices, take payments or post anything to the ledger in Phase 1. The billing plan is stored and validated (it must add up to 100%) so that Phase 2 can drive invoices from it.

> **ERP standard: why the order is separate from the quotation and the invoice.**
> In SAP SD or Oracle Order Management the *quotation* is an offer, the *sales order* is the accepted contract, and the *invoice* is a fiscal document raised against the order as it is fulfilled. Keeping them separate is what lets you answer "what is still owed to the customer" (order book / backlog) and "what has the customer been billed" independently. If the quotation were edited into the contract, the original offer would be lost; if the invoice were the only record, nothing would show the undelivered balance.

---

# 2. How Sales relates to other modules

| Other module | What Sales uses / does | Direction |
|---|---|---|
| **CRM** | `crm_organizations` is the customer master (`customer_id`), contacts from `crm_org_contacts`, products from `crm_products`. A draft can be **pre-filled from a won inquiry** (lines and prices from its accepted quotation, else the newest non-rejected one) **or an awarded tender** (`GET /sales/orders/prefill`). On confirmation, `crm/services/won.py → mark_won()` closes the source inquiry as "Closed - Ordered" / tender as "Closed – Ordered" in the same transaction. Inquiry and tender detail panels show a **Create Sales Order** button or the linked-SO chip (`components/crm/SalesOrderHandoff.tsx`, via `GET /sales/orders/by-source`). | Reads CRM; writes the source status at confirmation |
| **Production** | `production_rrv_builds` gained `sales_order_id`, `sales_order_line_id`, `sales_schedule_id` (unique). Linking a build to a vehicle row copies customer, PO and SO number onto the build, and sets the build's target handover date if it had none. The build's **target handover date becomes the row's committed date**; the build's status drives the row status (§6.5). `GET /sales/schedule/by-build/{build_id}` returns the SO, due date and LD rate for a build (readable with `sales` or `production`). | Sales writes the link fields on the build; reads build status and stages |
| **Store** | `store_items` as an optional `product_item_id` on a line | Read only |
| **Accounts** | Money columns use the Accounts `Money` / `Rate` / `Percent` / `Quantity` types. The SO number comes from the Accounts FY number series (`accounts/services/fiscal.next_number("SO", …)`). Confirmation broadcasts a bell to `accounts` app users. No postings. | Reads the number series |
| **Organization** | `branches` (optional `branch_id`), users, department heads (default Sales Head), `is_director`, `is_partner` (Company Info › Partners) | Read only |
| **Quality** | The Order Acknowledgement PDF goes through the shared renderer `quality/reports/render.py` | Library use |
| **Main** | Managed documents (`main/services/managed_documents`), notifications (`utils/notifications.notify_user`), audit log | Library use |

---

# 3. Roles and permissions

The module is gated by the app key `sales`. Fine-grained rights come from the standard permission registry (`core/permission_registry.py`, `MODULES["sales"]`), which an admin sets in the Permission Matrix.

## 3.1 Subtabs

| Subtab key | Nav label | What it gates |
|---|---|---|
| `dashboard` | Dashboard | `GET /sales/dashboard` |
| `orders` | Sales Orders | Orders and amendments. `create` = new SO / new amendment / prefill. `edit` = edit draft, submit, hold / resume, cancel, issue OA, amendment edit / submit / cancel, upload documents. `approve` = approve / return / reject orders and amendments, short-close, close. `delete` = delete a draft. `print` = OA PDF. |
| `delivery` | Delivery | The schedule board and DP extensions. `edit` = edit a delivery row, link / unlink a build. `create` = record a DP extension request. `approve` = grant / refuse it. DP-extension letters are filed under this tab. |
| `reports` | Reports | Order book, backlog, LD exposure |
| `settings` | Settings | Sales settings (§10). Editing needs admin or an explicit `sales:settings:edit` grant (shared settings framework rule). |
| `billing`, `quotations`, `pricing` | — | Registered for Phases 2–3; no pages or endpoints yet |

## 3.2 Typical roles and the approval chain

| Role | Who | What they do |
|---|---|---|
| **Sales executive (maker)** | Sales / BD staff | Creates the draft, attaches the customer PO, schedules every vehicle, submits. Owns the order as `sales_owner_id`. |
| **Sales Head (level 1)** | The user in the `sales_head_id` setting; if blank, the active department head(s) of a Sales / BD department | Approves every SO and amendment. Only the Sales Head can cancel a *confirmed* order, short-close and close. |
| **Director (level 2)** | `is_director` users with the Sales app | Approves above the Sales Head limit |
| **Partner (level 3, top)** | `is_partner` users with the Sales app | Approves above the Director limit **and any order or amendment that deviates from standard terms**, whatever its value |
| **Production planner** | `is_production_manager` with the Production app | Notified at confirmation to plan and link builds |

Routing is computed at submit (`service.required_level`):

```text
deviation flags present                → Sales Head → Director → Partner
grand total > approval_limit_director  → Sales Head → Director → Partner
grand total > approval_limit_sales_head→ Sales Head → Director
otherwise                              → Sales Head
```

Deviation flags (`SALES_DEVIATION_FLAGS`): `ld_uncapped` (LD applies with no cap), `ld_cap_above_standard`, `warranty_above_standard`, `advance_below_standard` (only when the minimum-advance setting is above 0). For an amendment the value used is `|value_change|`, and the flags are recomputed from the proposed terms.

**Controls enforced in code (`service.check_approver`):**
- The approver needs `sales:orders:approve` **and** must hold the level (Sales Head id / `is_director` / `is_partner`).
- **Four-eyes:** the submitter can't approve any level.
- **Each level is a different person:** someone who already approved in this round can't approve the next level.
- **Admin stand-in:** an admin who doesn't hold the level may approve, but only with a comment; the approval row is stored with `stand_in = true`.
- Submit is refused up front if any level in the chain has nobody (other than the maker) able to approve it, with the fix in the message.
- Each submit bumps `approval_round`; decisions from an earlier (returned) round don't count.
- Decisions lock the order row (`SELECT … FOR UPDATE`) so two approvers acting at once are serialised.

> The ₹ limits are **not decided by the owner yet** (2026-10-07). The defaults (₹50 L / ₹2 Cr) are editable Sales settings — see [plan.md](plan.md) §15 Q1.

---

# 4. Data model

All tables use `TimestampMixin`; `sales_orders` and `sales_attachments` also use `SoftDeleteMixin`. Every model is registered in `core/audit_registry.py`. Statuses and types are **coded tuples in the model files** (no metadata customization). Migration: `c5e8a2d4f7b1_add_sales_module_phase1.py`.

## 4.1 `sales_orders` (`SalesOrder`), numbered `SO/<FY>/<NNNN>` at confirmation

| Group | Fields |
|---|---|
| Identity | `so_number` (null until confirmed; a draft displays as "Draft #<id>"), `status`, `order_type` (`rrv_supply` / `spares` / `service` / `other`) |
| Customer | `customer_id` → `crm_organizations`, `customer_contact_id`; snapshot at submit/confirm: `customer_name`, `billing_address`, `customer_gstin`, `place_of_supply_state_code` (from the GSTIN's first two digits), `customer_state` |
| Source | `source_type` (`inquiry` / `tender` / `direct`), `source_inquiry_id`, `source_tender_id`, `source_quotation_id`, `source_quotation_number` |
| Customer PO | `customer_po_number`, `customer_po_date`, `customer_po_received_date`, `loa_number`, `loa_date`, `contract_reference`, `purchaser_name`, `paying_authority` |
| Commercial | `currency` (INR only), `price_basis` (`ex_works` / `for_destination` / `for_dispatch`), freight, insurance and payment terms labels |
| Totals (server-computed) | `subtotal`, `discount_total`, `taxable_total`, `gst_total`, `grand_total` |
| Inspection | `inspection_agency`, `third_party_inspection_required` |
| LD | `ld_applicable`, `ld_rate_percent`, `ld_rate_period` (`week` = per week or part thereof / `day`), `ld_basis` (`delayed_value` / `contract_value`), `ld_max_percent` (null = uncapped) |
| Warranty | `warranty_months_from_delivery`, `warranty_months_from_commissioning`, `warranty_rule` (`from_delivery` / `from_commissioning` / `earlier_of` / `later_of`), `warranty_terms_text` |
| PBG | `pbg_required`, `pbg_percent`, `pbg_due_days` (recorded only; BG tracking is Phase 3) |
| Approval | `deviation_flags` (JSON), `required_approval_level`, `approval_round`, submitted / confirmed / OA-issued by and at, `amendment_no` |
| Lifecycle | `held_from_status`, `hold_reason`, `cancel_reason`, `short_close_reason`, `close_reason`, `return_comment` |
| Ownership | `sales_owner_id`, `branch_id`, `created_by_id` |

## 4.2 `sales_order_lines` (`SalesOrderLine`)

`line_number` (unique per SO), `line_type` (`rrv` / `spares` / `service` / `freight` / `other`), `crm_product_id`, `product_item_id`, `rrv_model`, `description` (required — the PO wording), `specification`, `customer_line_ref`, `hsn_sac_code`, `uom`, `quantity` (whole number for `rrv`), `unit_price`, `discount_percent`, `gst_rate` (0–28, default 18), and the computed `discount_amount`, `taxable_amount`, `gst_amount`, `line_total`. Progress columns `qty_scheduled`, `qty_dispatched`, `qty_delivered`, `qty_invoiced`, `qty_cancelled` are maintained by the service from the schedule.

## 4.3 `sales_order_schedules` (`SalesOrderSchedule`) — one row per vehicle / lot

`so_line_id`, `sequence`, `quantity` (**exactly 1 for an RRV line**), consignee (name, address, GSTIN, state code, contact), three dates — `contract_delivery_date` (as signed), `current_delivery_date` (after DP extensions and amendments), `committed_date` (from the linked build's target handover) — `rrv_build_id`, `erp_project_id`, derived `status`, `dispatched_on` / `delivered_on` / `commissioned_on`, LD snapshot (`ld_weeks` = periods, `ld_amount`, `ld_computed_at`, `ld_waived`), `risk_flag` (`at_risk` / `overdue`, set by the daily job), `warranty_start` / `warranty_end` (not filled yet — Phase 2).

## 4.4 `sales_billing_plan_lines` (`SalesBillingPlanLine`)

`milestone_type` (`advance`, `drawing_approval`, `inspection`, `dispatch`, `delivery`, `commissioning`, `retention_release`, `other`), `description`, `percent` (> 0, ≤ 100; all milestones must total 100), `amount` (= grand total × percent), `per_unit`, `due_days`, `recovers_advance_percent`, `status` (`not_due` … `settled`; only `not_due` is used in Phase 1), `invoiced_amount`.

## 4.5 `sales_order_amendments` (`SalesOrderAmendment`)

`amendment_no`, `customer_amendment_ref` / `_date`, `reason` (required), `proposed` (a full copy of the amendable header terms, lines, schedule and billing plan), `changes` (old → new diff), `value_change`, `new_grand_total`, `deviation_flags`, `status` (`draft` → `pending_approval` → `approved` / `rejected` / `cancelled`), `required_approval_level`, `approval_round`, submitter and approver.

## 4.6 `sales_delivery_extensions` (`SalesDeliveryExtension`)

`schedule_ids` (JSON list of rows), `requested_on`, `requested_new_date`, `reason_category` (`customer_cause` / `force_majeure` / `our_cause`), `reason`, `customer_letter_ref` / `_date`, `granted_new_date`, `with_ld`, `token_penalty_amount`, `status` (`requested` / `granted` / `refused`), `decision_remarks`, decided by / at.

## 4.7 `sales_approvals` and `sales_attachments`

- `sales_approvals`: one row per decision — `entity_type` (`sales_order` / `sales_amendment`), `entity_id`, `revision` (= approval round), `level`, `approver_id`, `decision` (`approved` / `rejected` / `returned`), `comment`, `stand_in`, `decided_at`.
- `sales_attachments`: polymorphic over `sales_order`, `sales_amendment`, `sales_extension`; `doc_type` (`customer_po`, `loa`, `amendment_letter`, `dp_extension_letter`, `pod`, `inspection_certificate`, `bank_guarantee`, `other`). Bytes live in SharePoint; the row keeps path, URL, size and uploader.

---

# 5. Number series

| Document | Format | Issued | Source |
|---|---|---|---|
| Sales order | `SO/<FY>/<NNNN>` (e.g. `SO/26-27/0001`) | At **confirmation** (final approval), not at draft | Accounts FY series `next_number(db, "SO", date)` — advisory lock + row lock, so two confirmations never share a number |
| Amendment | `amendment_no` 1, 2, … per SO | When the amendment draft is created | `so.amendment_no + 1` |
| Draft | "Draft #<id>" | — | Display only |

> **ERP standard: why the number is issued at confirmation.** A draft that is deleted or rejected would otherwise leave a gap in a statutory-looking series. SAP and Tally both number the order when it is saved as a real document; drafts and holds use a temporary id.

---

# 6. Workflows

## 6.1 Create a draft (CRM win, tender award, or direct PO)

1. **From CRM:** the inquiry / tender panel's **Create Sales Order** opens `/dashboard/sales/orders/new?inquiry=<id>` (or `?tender=`). `GET /sales/orders/prefill` returns customer, contact, source, lines (prices from the accepted quotation — or, with a warning note, the newest open one; never a rejected one), payment / delivery terms, inspection agency (RITES / RDSO detected from the inquiry), and the LD / warranty defaults from settings. If the source already has a live SO, the prefill returns it and the form points there instead.
2. **Direct:** blank form with the same term defaults (`GET /sales/orders/defaults`).
3. The form (`orders/new`) collects customer, contract terms, lines, delivery schedule, billing plan and the PO / LOA file. Saving creates a `draft`. For each `rrv` line with no rows, one open row per vehicle is generated.
4. While `draft`, the header (`PATCH`), lines, schedule and billing plan (`PUT …/lines`, `…/schedule`, `…/billing-plan`) can be edited. Totals are always recomputed on the server.

## 6.2 Submit (`POST /sales/orders/{id}/submit`)

The order is snapshotted from CRM, totals recomputed, then **every problem is listed at once** (422) — nothing is submitted until all are fixed:

- Customer still exists and has a GSTIN or a state (needed later for GST).
- PO number and PO date entered, and a `customer_po` or `loa` document attached.
- At least one line; every `rrv` / `spares` line fully scheduled with contractual dates; every RRV row exactly 1 vehicle.
- Billing plan adds up to exactly 100% (the message says how much is missing or extra).
- If LD applies: rate, period and basis entered. Warranty rule and the months it needs entered.
- Order value above zero.

Then: a **duplicate PO** check (same customer + same PO number on another live SO → 409), deviation flags and the required level (§3.2), and the routing check. The order moves to `pending_approval`, and the Sales Head is notified (bell + Teams).

## 6.3 Approve → confirm

Each `approve` records a `sales_approvals` row for the next level in the chain and notifies the next level (bell + Teams). **Credit check** (`credit_check_mode`): the customer's open order value (pending + confirmed + in execution + on hold, plus this draft) is compared with its CRM `credit_limit`; `warn` shows it on the order, `block` refuses the approval with the numbers, `off` skips it. AR outstanding is not yet included (Phase 2).

On the last approval the order is **confirmed**: SO number issued, customer re-snapshotted, schedule refreshed, the CRM source closed as ordered (`mark_won`), and bells sent to the maker / owner, to production planners ("link a planned RRV build to each vehicle") and to Accounts users.

`return` (with a reason) sends it back to `draft` with `return_comment`; `reject` (with a reason) cancels it and every row.

> **Difference from the plan:** plan §14 Phase 1 says confirmation creates planned RRV builds automatically (fallback: manual link). Phase 1 ships the **fallback only** — planners are notified and link existing builds from the Delivery tab (§6.5).

## 6.4 Sales order status machine

```text
draft ──submit──► pending_approval ──last approve──► confirmed ──(build in production)──► in_execution
  ▲                     │  return                         │                                  │
  └─────────────────────┘                                 ▼                                  ▼
                        reject ► cancelled      partially_delivered ──all rows delivered──► delivered ──close (Sales Head)──► closed

hold:   confirmed / in_execution / partially_delivered ⇄ on_hold   (resume returns to the held-from status)
cancel: draft / pending_approval (raiser or admin), confirmed (Sales Head; unlinks unstarted builds)
short-close: in_execution / partially_delivered (Sales Head; refused while any linked build has started)
```

`in_execution`, `partially_delivered` and `delivered` are **derived** by `service.refresh_order` from the rows, never set by hand. When an order ends (cancelled, rejected, short-closed, closed) its open amendment is cancelled and pending DP-extension requests are closed as "Closed (order ended)". A draft can be deleted (soft) by its creator, owner or an admin; anything submitted is cancelled with a reason instead.

## 6.5 Delivery rows, the build link and row status

On a confirmed order, a user with `delivery:edit` links each RRV row to a **planned or active RRV build** (`POST /sales/schedule/{sid}/link-build`; the picker lists builds not yet tied to an order). Checks: order confirmed, RRV line, row not cancelled, row not already linked, build exists and isn't cancelled, build not linked to another vehicle. Unlinking is refused once the build has started (Production decides first).

Row status is derived, never typed:

| Row status | When |
|---|---|
| `open` | No build (or build cancelled) |
| `build_planned` | Build `planned` |
| `in_production` | Build `in_progress` / `on_hold` |
| `ready` | Build beyond that (completed / handed over) |
| `dispatched` / `delivered` / `commissioned` | `dispatched_on` / `delivered_on` / `commissioned_on` entered on the row |
| `cancelled` | Removed by an amendment, cancel, reject or short-close |

The **committed date** comes from the build's target handover date and can't be edited on a linked row. Dispatch, delivery and commissioning dates are entered on the row (`PATCH /sales/schedule/{sid}`) in Phase 1; the Phase 2 dispatch note will set them.

## 6.6 Risk and LD (computed, not posted)

**Risk** (`service.risk_of`, daily job): `overdue` if today is past the current delivery date; `at_risk` if the committed date is after the current date, or the due date is within `at_risk_reminder_days` and the build hasn't reached Final Inspection.

**LD** (`service.ld_for`):

```text
delay   = reckoning date − current_delivery_date      (reckoning = POD for FOR-destination, else dispatch date;
                                                        today while undelivered)
periods = ceil(delay / 7)   if per week "or part thereof"   (8 days late = 2 weeks)
        = delay             if per day
LD      = rate% × periods × value of the delayed unit (taxable, per unit)
cap     = ld_max_percent × delayed unit value                 (basis delayed_value, per row)
        = ld_max_percent × contract taxable value, shared by all late vehicles (basis contract_value)
```

A waived row (DP extension "without LD") carries no LD. **Forecast LD** uses the committed date for undelivered rows. Order-level totals clamp at the contract-value cap minus LD already accrued on delivered vehicles, so dashboards don't overstate exposure.

## 6.7 DP extensions

1. Record a request (`delivery:create`) for chosen undelivered rows: requested date (must be after each row's current date), reason category, reason, customer letter.
2. **Grant** (`delivery:approve`): needs the customer's letter reference (the evidence if LD is disputed); the granted date can't move a row earlier. Each row's `current_delivery_date` moves; **without LD** sets `ld_waived`. An optional token penalty is recorded.
3. **Refuse**: records the customer's reason.

The contractual date never changes through an extension — only an amendment changes it.

## 6.8 Amendments (customer changes the order)

Only on `confirmed` / `in_execution` / `partially_delivered` / `on_hold` orders, and only **one open amendment at a time**. The draft starts as a full copy of the amendable parts. Header fields outside `AMENDABLE_HEADER` (customer, source, numbering, approval data) can't be changed. Lines can't be removed — set the quantity to 0. Removing a schedule row cancels it; a dispatched / delivered row can't be removed, and a row whose build has started blocks the amendment.

Submit computes the diff (field by field, old → new), `value_change`, `new_grand_total` and deviation flags, and routes it through the same chain as an order (§3.2). On final approval the proposal is applied, totals recomputed, `amendment_no` bumped and the order refreshed; unstarted builds on removed rows are unlinked and Production is told. A new contractual date on a row moves both its contract and its current date.

## 6.9 Order Acknowledgement (OA)

After confirmation, **Issue OA** stamps `oa_issued_at`. The OA is a **managed Word document of record** (`sales_order_ack`, revision = `amendment_no`): the order page's Documents tab shows `ManagedDocumentPanel` with "Save & Edit in Word" as the primary action; `GET /sales/orders/{id}/oa.pdf` renders the PDF (the Word document's PDF once one exists). It lists PO reference, lines, schedule, billing plan, LD and warranty in words, inspection and special conditions. Each amendment is a new revision ("ORDER ACKNOWLEDGEMENT — AMENDMENT n").

## 6.10 Documents

Upload / view / delete on `/sales/attachments` for orders, amendments and DP extensions. Viewing needs `view` on the owning tab (Orders, or Delivery for DP-extension letters); uploading and deleting need `edit` on it. Files are stored in SharePoint; if `SHAREPOINT_SITE_ID` is not configured the endpoints say so and how to fix it.

---

# 7. Dashboard and reports

**Dashboard** (`GET /sales/dashboard`): tiles for open order value and count, units due this month, overdue units, at-risk units, LD accrued and forecast, orders pending approval; lists of **approvals waiting for me**, **DP extensions waiting for the customer**, and **vehicles at risk or overdue** (top 25).

**Reports** (`/dashboard/sales/reports`):

| Report | Endpoint | Content |
|---|---|---|
| Order book | `GET /sales/reports/order-book` | Each open SO: customer, status, order month, models, taxable and grand total, delivered value, balance value, units total / delivered, next due date |
| Backlog | `GET /sales/reports/backlog` | Undelivered units by current delivery month: units, value, at-risk, overdue, LD forecast |
| LD exposure | `GET /sales/reports/ld-exposure` | Per SO: LD accrued and forecast (cap-respecting), overdue / at-risk units, and the rows behind them |

---

# 8. Notifications

All go through `notify_user`. **Teams is used only for approvals and reminders** (`teams=True`); everything else is bell-only. The actor never notifies themselves.

| `notification_type` | Recipients | When | Channel |
|---|---|---|---|
| `sales_order_approval_needed` | Holders of the next level (not the maker) | Submit; each intermediate approval; amendment submit / approval steps | Bell + Teams |
| `sales_order_confirmed` | Creator, submitter, owner; production planners; `accounts` app users (broadcast) | Final approval | Bell |
| `sales_order_returned` / `sales_order_rejected` | Submitter and creator | Return / reject | Bell |
| `sales_order_cancelled` | Production planners | A confirmed order is cancelled and builds were unlinked | Bell |
| Amendment approved / rejected (and "builds released") | Submitter, creator, owner; planners when builds were unlinked | Amendment decided | Bell |
| `sales_extension_granted` / `sales_extension_refused` | Requester and SO owner | DP extension decided | Bell |
| `sales_delivery_at_risk` | SO owner and Sales Head(s) | A row newly turns at-risk (daily job) | Bell + Teams |
| `sales_delivery_overdue` | SO owner and Sales Head(s) | Rows overdue (daily job), with LD accrued so far | Bell + Teams |
| `sales_approval_pending_reminder` | Holders of the pending level | Order waiting > 2 days for approval (daily job) | Bell + Teams |

Bell links: `sales_order` → order page, `sales_amendment` → orders list, `sales_extension` → Delivery page (`NotificationBell.tsx`).

---

# 9. Scheduled jobs

| Job id | Time (IST) | Code | What it does |
|---|---|---|---|
| `sales_scheduler` | 06:30 daily | `tasks/sales_scheduler.py` → `run_sales_scheduler` | For every confirmed / in-execution / partially delivered / on-hold order: re-derive row status, committed date and accrued LD, set `risk_flag`, send at-risk (only on the transition) and overdue reminders. Then remind approvers of orders pending more than 2 days. Each order is committed on its own. |

Reminders are sent at most once per user / order / type / day, so re-running the job the same day is harmless.

---

# 10. Settings

Sales › Settings uses the **shared settings framework** (`core/settings_framework.py`, `modules/sales/settings.py`; endpoints `GET/PUT /sales/settings`, `POST /sales/settings/reset/{key}`). Values only — keys and types are code. A value equal to the code default is not stored. Every change is audited.

| Group | Key | Default | Effect |
|---|---|---|---|
| Order approval | `sales_head_id` | blank (= Sales / BD department head) | Level-1 approver; cancel / short-close / close authority |
| | `approval_limit_sales_head` | ₹50,00,000 | Up to this, Sales Head only (owner undecided — editable) |
| | `approval_limit_director` | ₹2,00,00,000 | Up to this, + Director; above, + Partner. Must be ≥ the Sales Head limit (cross-check on save). |
| | `credit_check_mode` | `warn` | `off` / `warn` / `block` |
| Standard terms | `standard_ld_max_percent` | 10% | LD cap above this (or uncapped) → Partner |
| | `standard_warranty_months_max` | 30 | Longer warranty → Partner |
| | `standard_min_advance_percent` | 0 (check off) | Advance below this → Partner |
| New order defaults | `default_ld_rate_percent`, `default_ld_period`, `default_ld_basis` | 0.5% / week / delayed value | Pre-filled on new orders |
| | `default_warranty_months_from_delivery`, `…_from_commissioning`, `default_warranty_rule` | 30 / 24 / earlier of | Pre-filled on new orders |
| Delivery tracking | `at_risk_reminder_days` | 14 | At-risk window (§6.6) |

---

# 11. API endpoints

All routes are under `/api/v1`, tagged `Sales`. Every router needs the `sales` app unless noted.

**Orders** (`routes/orders.py`)
| Method and path | Permission |
|---|---|
| `GET /sales/orders?status&customer_id&open_only&pending_my_approval&at_risk&month&search` / `GET /sales/orders/{id}` / `GET …/{id}/timeline` | `orders` view |
| `GET /sales/orders/prefill?inquiry=|tender=` | `orders:create` |
| `GET /sales/orders/defaults` | app |
| `GET /sales/orders/by-source?inquiry=|tender=` | `sales` **or** `crm` app |
| `POST /sales/orders` | `orders:create` |
| `PATCH /sales/orders/{id}`, `PUT …/lines`, `PUT …/schedule`, `PUT …/billing-plan` (draft only) | `orders:edit` |
| `DELETE /sales/orders/{id}` (draft only; creator / owner / admin) | `orders:delete` |
| `POST …/submit`, `…/hold`, `…/resume`, `…/cancel`, `…/issue-oa` | `orders:edit` (cancel of a confirmed order: Sales Head) |
| `POST …/approve`, `…/return`, `…/reject` | `orders:approve` + level holder |
| `POST …/short-close`, `…/close` | `orders:approve` + Sales Head |
| `GET …/{id}/oa.pdf` | `orders:print` |

**Amendments** (`routes/amendments.py`)
| Method and path | Permission |
|---|---|
| `GET /sales/orders/{id}/amendments`, `GET /sales/amendments/{aid}` | `orders` view |
| `POST /sales/orders/{id}/amendments` | `orders:create` |
| `PATCH /sales/amendments/{aid}`, `POST …/submit`, `POST …/cancel` | `orders:edit` |
| `POST /sales/amendments/{aid}/approve`, `…/reject` | `orders:approve` + level holder |

**Delivery** (`routes/schedule.py`)
| Method and path | Permission |
|---|---|
| `GET /sales/schedule?status&month&risk&customer_id` | `delivery` view |
| `GET /sales/schedule/by-build/{build_id}` | `sales` **or** `production` app |
| `PATCH /sales/schedule/{sid}`, `POST …/link-build`, `POST …/unlink-build` | `delivery:edit` |
| `GET /sales/extensions`, `GET /sales/orders/{id}/extensions` | `delivery` view |
| `POST /sales/orders/{id}/extensions` | `delivery:create` |
| `POST /sales/extensions/{eid}/grant`, `…/refuse` | `delivery:approve` |

**Dashboard and reports** (`routes/dashboard.py`): `GET /sales/dashboard` (`dashboard` view); `GET /sales/reports/{order-book|backlog|ld-exposure}` (`reports` view).

**Lookups** (`routes/lookups.py`, app): `meta`, `customers`, `customers/{id}/contacts`, `products`, `builds` (unlinked, not cancelled), `inspection-agencies`, `branches`, `users`.

**Documents** (`routes/documents.py`): `GET /sales/attachments?entity_type&entity_id`, `POST /sales/attachments`, `GET /sales/attachments/{id}/content`, `DELETE /sales/attachments/{id}` — tab rules in §6.10.

**Settings** (`routes/settings.py`): `GET/PUT /sales/settings`, `POST /sales/settings/reset/{key}`.

---

# 12. Frontend pages

| Route | Page |
|---|---|
| `/dashboard/sales` | Dashboard: tiles, approvals waiting for me, DP extensions pending, vehicles at risk / overdue |
| `/dashboard/sales/orders` | Order list with filters |
| `/dashboard/sales/orders/new` (`?inquiry=` / `?tender=`) | New order form: customer, contract terms, lines, delivery schedule, billing plan, PO / LOA upload |
| `/dashboard/sales/orders/[id]` | Order detail with tabs **Overview · Lines · Schedule · Billing · Amendments · Documents · Approvals · Timeline**; action buttons follow the server's `can_*` flags (submit, approve / return / reject, hold / resume, cancel, short-close, close, issue OA). The Documents tab carries the OA `ManagedDocumentPanel`. |
| `/dashboard/sales/delivery` | Delivery schedule board (every open vehicle by due month with build stage, risk and LD) and DP extensions waiting for the customer |
| `/dashboard/sales/reports` | Order book, backlog by month, LD exposure |
| `/dashboard/sales/settings` | Shared `ModuleSettingsPage` |

Shared components are in `frontend/src/components/sales/`: `SalesNav`, `SalesUi`, `OrderEditors`, `OrderTermsFields`, `DeliveryPanel`, `AmendmentPanel`, `labels.ts`. CRM's `components/crm/SalesOrderHandoff.tsx` is the CRM-side button / chip. Guided tours: `lib/tour/modules/sales.ts` with configs `salesDashboard`, `salesOrdersList`, `salesOrderForm`, `salesOrderDetail`, `salesDelivery`.

Tests: `backend/app/tests/test_sales.py`, `test_sales_crm_handoff.py`, `test_sales_hardening.py`.

---

# 13. Known gaps (Phase 1)

1. **No automatic build creation at confirmation** — builds are linked by hand from the Delivery tab (plan §14 fallback).
2. `GET /sales/schedule/by-build/{id}` exists for the Production build header, but **no Production page calls it yet**.
3. Dispatch, delivery and commissioning dates are typed on the row; there is no dispatch note, POD capture or Quality Rule 8 check yet (Phase 2).
4. Billing plan milestones never become due; no proforma, no invoice request, no advance tagging (Phase 2). `qty_invoiced` stays 0.
5. Warranty dates (`warranty_start` / `warranty_end`) are not filled (Phase 2, written onto machines at delivery / commissioning).
6. Credit check uses open order value only, not AR outstanding.
7. INR only; no export orders. No price lists, quotation approval or bank guarantee register (Phase 3).
8. Approval ₹ limits are defaults pending the owner's decision.

---

# 14. What this module does not do

- It does not post to Accounts (no LD entries, no invoices, no receipts). LD is computed for visibility and dispute preparation only.
- It does not own customers or products — CRM does.
- It does not plan or execute builds — Production does. Sales only links to them and reads their status.
- It does not issue stock or create dispatch documents (Phase 2, with Store / Finance).

---

# 15. Related documentation

- [Sales plan](plan.md): design decisions, phases and open questions
- [CRM overview](../crm/overview.md): inquiries, tenders and quotations that feed the SO
- [Production RRV Build](../production/rrv-build.md): the build each vehicle row links to
- [Changelog](../../09-operations/changelog.md)
