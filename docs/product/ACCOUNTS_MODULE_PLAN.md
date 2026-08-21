# Accounts Department Module — Roadmap

## ⚠️ Confirm scope before building

`docs/product/PRODUCT.md` lists "Accounting/finance module (exists in SAP)" as an explicit non-goal. This plan assumes that still holds and scopes Accounts as a **read-only visibility layer** rolling up cost/value data the portal already owns — not a ledger, not AP/AR automation, not a SAP replacement. If that assumption is wrong, stop and get this re-scoped as a proper finance system plan before building anything here — it would be a materially larger and different plan.

## Design reference: mapping SAP FI/CO concepts onto this portal's data

Premnath's actual system of record for accounting is SAP FI (General Ledger, AP, AR) and CO (Cost Center/Profit Center Accounting). This portal is **not** re-implementing GL posting, journal entries, or 3-way invoice matching — SAP already owns that. What this module *can* usefully do is give finance/ops staff a same-day, portal-native preview of numbers that otherwise only surface at SAP month-end close, built entirely from data this portal already owns. Each SAP concept below has a narrow, deliberately-thin analog — read the "NOT doing" column as the actual scope boundary.

| SAP FI/CO concept | This portal's analog | Data source | NOT doing |
|---|---|---|---|
| GL Account / Chart of Accounts (FS00) | N/A — no chart of accounts here | — | No GL account master, no journal entries (FB01), no debit/credit posting |
| Trial Balance (FAGLL03) | Simple revenue/cost summary tiles | CRM PO value, P2P PO value, service billing | No opening/closing balance per account, no multi-currency, no period-lock |
| Accounts Receivable line items (FBL5N) — customer aging | "Customer Billing Status" view | ERP `ServiceRequest.total_bill`/`payment_status`, CRM `PurchaseOrder.po_value` | No dunning, no credit limit enforcement, no payment-terms calculation (2/10 NET30 discounts etc.) — those live in SAP AR |
| Accounts Payable line items (FBL1N) — vendor aging | "Vendor Spend Status" view | P2P `P2PPurchaseOrder` status/value, `Vendor` qualification | No 3-way match, no payment run, no AP liability posting |
| Cost Center Accounting (KS01, S_ALR_87013611) | Department spend rollup | `User.department`, P2P `PRRequest.department`, PO cost allocation once it exists | No cost-element-level budget vs. actual, no assessment/distribution cycles |
| Profit Center Accounting (KE51, 1KEA) | Project-level P&L | ERP `Project`, CRM `Organization` (client/region), matched PO revenue vs. P2P/service cost | No formal profit center master, no corporate-allocation waterfall |
| Profitability Analysis (S_ALR_87016263) | "Top clients / top projects by margin" view | Same join as Project P&L, grouped differently | No multi-characteristic drill-down, no contribution-margin hierarchy |

The FI/CO guides make clear how much machinery real GL/CO carries (document types, posting keys, reconciliation accounts, settlement runs) — none of that belongs here. This module's job is narrower and different in kind: **surface the same underlying business events SAP will eventually post, a few weeks earlier, in one place, without owning any of the accounting logic.**

## Current state

No `accounts` module exists. The data it would roll up already lives in three other modules:
- CRM `PurchaseOrder.po_value` (customer orders — revenue side, SAP's SD→AR equivalent)
- ERP `ServiceRequest.service_cost` / `total_bill` / `payment_status` (service billing)
- Purchase/P2P `P2PPurchaseOrder.total_value`, vendor spend (cost side, SAP's MM→AP equivalent, once [[purchase-department]] Phase 3 costing lands)

## Phase 1 — Read-only Dashboard (Trial-Balance-style summary)

- New `backend/app/modules/accounts/` with **no new tables** — routes query existing CRM/ERP/P2P tables directly by id-reference (read-only joins, never writes), same boundary discipline as every other module.
- Dashboard (`/dashboard/accounts`): revenue booked (CRM POs) vs. cost committed (open P2P POs) vs. cost spent (closed P2P POs) vs. service billing collected, by month/project — the same four-number shape as a trial balance's revenue/expense summary, without the underlying GL machinery.
- `require_app_access("accounts")` — a small, distinct user population (finance staff), separate from Purchase/CRM's own access.

## Phase 2 — AR/AP Status Views (aging-report shape, not aging logic)

- **Customer Billing Status** (FBL5N-shaped): list `ServiceRequest`s and CRM `PurchaseOrder`s grouped by `payment_status`, with days-since-invoice as a simple computed column — visually similar to SAP's customer aging buckets (current / 30-60 / 60+), but sourced from whatever payment-status field already exists on those records, not a real AR sub-ledger.
- **Vendor Spend Status** (FBL1N-shaped): list P2P `P2PPurchaseOrder`s by status (`issued`/`acknowledged`/`fulfilled`), a lightweight vendor-aging analog once Purchase Phase 5 (invoice tracking) exists to provide a due date to age against — until then, this view only shows PO status, not payment aging.
- Both are pure read rollups — no dunning, no reminders sent, no write-back to the source records.

## Phase 3 — Project P&L View (Profit-Center-report shape)

- Per-project rollup: CRM PO value in, Purchase/P2P PO value out, service billing, computed margin — the same shape as SAP's Profit Center P&L report (1KEA), scoped to one project instead of one division. Depends on [[project-management]]'s and [[purchase-department]]'s data existing to be meaningful, not a blocker to building the view itself (it'll just show zeros until those are populated).
- Cost-Center-style secondary cut: same numbers grouped by `department` instead of by project, for a department-spend view analogous to SAP's Cost Center report.
- Export to Excel for handoff to the actual SAP-based finance process — the portal surfaces the number, SAP remains the system of record for the posted version.

## Phase 4 — Receivables/Payables Visibility (only if Phase 5 lands elsewhere)

- If Purchase Phase 5 (invoice tracking, itself gated on finance sign-off) and a symmetric CRM customer-invoice tracking are built, Accounts becomes the natural single screen showing both — outstanding payables (vendor invoices) and receivables (customer invoices) side by side, closer to a true AR/AP aging pair. Do not build invoice data model here — this phase only consumes what those other modules already track.

## Interconnections

| With | Relationship |
|---|---|
| [[business-development]] (CRM) | Reads `PurchaseOrder.po_value` for revenue booked — read-only, no write-back |
| [[purchase-department]] | Reads `P2PPurchaseOrder.total_value` and vendor spend for cost committed/spent — read-only |
| [[service-commissioning]] | Reads `ServiceRequest.service_cost`/`total_bill`/`payment_status` for service revenue — read-only |
| [[project-management]] | Project-level P&L (Phase 3) joins against whatever project/milestone entity that module lands on |

## Cross-cutting

- Register `"accounts"` in `AVAILABLE_APPS` before any UI work.
- Every query is a read-only join across module boundaries by id — Accounts never writes to another module's tables, and never becomes a second source of truth for a number another module already owns.
- If anyone asks for AP/AR aging with real payment-terms math (2/10 NET30 discount windows), 3-way invoice matching, dunning procedures, or GL posting — that is genuinely SAP FI/CO territory (see the concept table above) and should be redirected there, not organically grown into this module one field at a time.
