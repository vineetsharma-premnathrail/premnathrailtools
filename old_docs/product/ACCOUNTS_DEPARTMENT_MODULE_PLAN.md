# Accounts Department — Full Ledger Module Plan

> **Supersedes `ACCOUNTS_MODULE_PLAN.md`** (which stays as a historical record of the original read-only-rollup scope). Confirmed 2026-08-18: Accounts will run a real parallel General Ledger (Journal Entries, GL accounts, AP/AR sub-ledgers, period close) inside this portal, not just a read-only view over other modules' data. `PRODUCT.md`'s "Accounting exists in SAP" non-goal has been marked reversed accordingly.
>
> This is the largest, longest-running module in the entire department roadmap — real double-entry bookkeeping, reconciliation, and period-close discipline are not a weekend build. Treat every phase below as independently shippable and useful on its own; do not attempt to build all of Part A–H in one pass.

## Why this is different from every other department plan

Every other department plan in this roadmap follows the "reference other modules by id, never write to their tables" boundary rule from [[premnathrail-app-design]]. Accounts breaks that rule on purpose, in one specific direction: **Accounts reads business events from every other department (PO created, GRN posted, invoice received, payroll run, sales delivered) and is the only module allowed to turn them into a Journal Entry.** No other module ever posts to `journal_entries`/`gl_balances` directly — this is the equivalent of SAP's FI module being the sole GL-posting authority while MM/SD/HCM/PP only trigger postings through defined integration points.

## Part A — Master Data (Phase 1)

Translated into this codebase's conventions: SQLAlchemy models under `backend/app/modules/accounts/models/`, Pydantic `Create`/`Update`/`Response` schemas per [[premnathrail-app-design]], not raw table DDL.

### `GLAccount` (`gl_accounts`)
- `code` (unique, e.g. `1401`), `name`, `account_type` (`asset`/`liability`/`equity`/`revenue`/`expense`), `account_sub_type`, `account_group_id` FK, `currency`, `status` (`active`/`inactive`), `opening_balance`, `balance_sheet_position` (`A`/`L`/`E`), `is_posting_account` (bool — leaf accounts only can receive postings, matching SAP's posting-account concept), `is_control_account` (bool — AP/AR control accounts reconcile against sub-ledgers).
- Seed the chart of accounts Premnath actually uses — do not invent a generic one; get the real chart from whoever owns SAP FI configuration today.

### Vendor/Customer master extension
- **Do not create new `VENDOR_MASTER`/`CUSTOMER_MASTER` tables** — `vendor.Vendor` (built, [[purchase-department]]) and CRM `Organization` (built, [[business-development]]) already exist and are the correct place for these. Extend them additively:
  - `Vendor`: `bank_name`, `bank_account_no`, `ifsc_code`, `account_holder_name`, `payment_terms_id` FK, `credit_limit`, `payment_days`, `early_payment_discount_pct`, `gl_reconciliation_account_id` FK.
  - `Organization` (CRM, acting as customer master for this purpose): `credit_limit`, `credit_days`, `discount_percentage`, `gl_reconciliation_account_id` FK.
- This is the one deliberate exception to "Accounts owns its own master data" — vendor/customer identity is already owned elsewhere, Accounts only adds the GL-relevant fields onto the existing row, same mirror-extension pattern used throughout this codebase (see HR's `reporting_manager_id` addition to `User` for precedent).

### `BankAccount` (`bank_accounts`)
- `bank_name`, `account_no` (unique), `account_holder_name`, `branch_name`, `ifsc_code`, `currency`, `opening_balance`, `current_balance` (materialized cache, recomputed from `journal_entry_lines` the same way Store's `StockBalance` is recomputed from `StockTransaction` — never hand-edited), `gl_account_id` FK (the GL account this bank account posts through), `status`.

### `CostCenter` (`cost_centers`)
- `code`, `name`, `description`, `department` (free text, matching `User.department`), `manager_id` FK `users.id`, `cost_center_type` (`production`/`service`/`admin`/`support`), `annual_budget`, `budget_period` (`YYYY-MM`), `gl_account_id` FK.
- This is the Cost-Center-Accounting analog already sketched in `PURCHASE_DEPARTMENT_MODULE_PLAN.md`'s Phase 3 (`project_budget`) and `PRODUCTION_MODULE_PLAN.md`'s Phase 3.5 — converge onto this one table rather than three separate budget concepts.

### `InternalOrder` (`internal_orders`)
- `code`, `name`, `description`, `order_type` (`capital`/`maintenance`/`it`/`training`), `start_date`, `end_date`, `budgeted_amount`, `gl_account_id` FK, `cost_center_id` FK (nullable), `status` (`open`/`in_progress`/`completed`/`closed`).
- `actual_amount` and `variance` are **computed at read time** from linked `journal_entry_lines`, never stored columns — same "never a separately-maintained running balance" rule as Store's balances and Production's cost calculations.

## Part B — The Ledger Engine (Phase 2, the real core)

### `JournalEntry` (`journal_entries`)
- `posting_date`, `accounting_period` (`YYYY-MM`), `posting_type` (`invoice`/`salary`/`transfer`/`adjustment`/`payment`), `reference_document_type`/`reference_document_id` (generic reference, same pattern as Quality's `reference_type`/`reference_id` in `QUALITY_MODULE_PLAN.md`), `description`, `total_debit`, `total_credit`, `status` (`draft`/`posted`/`reversed`/`cancelled`), `created_by_id`/`approved_by_id`/`posted_by_id` FKs `users.id`, `reversal_date`/`reversal_reason`/`reversed_by_id`.
- **Server-side invariant, enforced in `service.py` before any commit**: `total_debit == total_credit`, checked to the paisa. This is the single most important validation in the whole module — see Part G's "Exception 1" for the exact user-facing behavior when it fails.
- Every `JournalEntry` is created through a small number of **posting functions** (`post_vendor_invoice()`, `post_customer_invoice()`, `post_payroll()`, `post_payment()`, `post_production_settlement()`) — never a generic "create arbitrary JE" endpoint exposed to non-Accounts users. Manual/adjustment JEs are the one case where a raw line-item entry form is appropriate, gated to Accounts staff only.

### `JournalEntryLine` (`journal_entry_lines`)
- `journal_entry_id` FK, `line_number`, `gl_account_id` FK, `cost_center_id`/`internal_order_id` (nullable FKs), `debit_amount`/`credit_amount` (exactly one non-zero per line), `vendor_id`/`customer_id` (nullable — which sub-ledger this line affects), `due_date` (for AP/AR aging), `remarks`.

### `GLBalance` (`gl_balances`)
- `gl_account_id`, `accounting_period`, `opening_balance`, `total_debits`, `total_credits`, `closing_balance`, `is_locked` (bool — see Part G's period-lock exception).
- **Materialized, recomputed from `journal_entry_lines`** — same "cache, not source of truth" rule as every balance table in this codebase (Store's `StockBalance`, Bank's `current_balance` above). Recompute on every posting to the period, don't try to maintain it incrementally in a way that can drift.

## Part C — Accounts Payable: Vendor Invoice → Payment (Phase 3)

### `VendorInvoice` (`vendor_invoices`)
- `purchase_order_id` FK `p2p_purchase_orders.id` (the existing built entity — see [[purchase-department]]), `vendor_id` FK, `invoice_number`, `invoice_date`, `invoice_amount`, `invoice_gst`, `invoice_total`, `qty_po`/`qty_gr`/`qty_invoice` (denormalized snapshot for the match display), `matching_status` (`matched`/`unmatched`/`variance`), `payment_status` (`pending`/`partial`/`paid`), `amount_paid`, `amount_due`, `hold_status` (`none`/`on_hold`/`blocked`), `hold_reason`, `journal_entry_id` FK (once posted).

### 3-way match — copies SAP MIRO's exact shape (already scoped as Phase 5 in `PURCHASE_DEPARTMENT_MODULE_PLAN.md`, now given a real home)
- Compare (a) PO qty/amount from `P2PPurchaseOrder`, (b) cumulative GRN qty from `P2PRequest.received_quantity` / Store `stock_transactions`, (c) invoice qty/amount entered here.
- **Tolerance, not hard block**: configurable `qty_tolerance_pct` (default 2%) and `amount_tolerance_pct` (default 1%) — within tolerance auto-sets `matching_status="matched"` and the invoice can post immediately; outside tolerance sets `matching_status="variance"` and requires Finance Manager approval before posting (see Part G Exception 3 for the exact approval flow).
- On match/approval, call `post_vendor_invoice()`:
  ```
  Debit: Inventory/Expense GL (from PO's account assignment) = invoice_amount
  Debit: GST Input GL = invoice_gst
  Credit: AP control GL = invoice_total
  ```

### Payment
- `PaymentTransaction` (`payment_transactions`): `payment_type` (`vendor`/`customer`/`employee`/`other`), `payment_mode` (`cheque`/`neft`/`rtgs`/`cash`), `payment_date`, `amount`, `bank_account_id` FK, `cheque_number`/`cheque_date`, `vendor_id`/`customer_id` (nullable), `reference_id` (invoice/JE), `reconciliation_status` (`pending`/`reconciled`/`mismatch`), `journal_entry_id` FK.
- Early-payment-discount math (2/10 NET30 style) reads `Vendor.early_payment_discount_pct` and `Vendor.payment_days` — implement exactly once here, since three different SAP guides you shared show this calculation and it's easy to get the rounding wrong; write one tested `compute_early_payment_discount()` function in `service.py`, don't inline the math at each call site.

## Part D — Accounts Receivable: Customer Invoice → Collection (Phase 4)

### `ARTransaction` (`ar_transactions`)
- `customer_id` FK `organizations.id`, `sales_order_reference`/`delivery_reference` (CRM `PurchaseOrder`/ERP `ServiceRequest` ids, generic reference), `invoice_amount`, `gst_amount`, `total_amount`, `discount_amount`, `amount_received`, `amount_due`, `days_outstanding` (computed at read time from `invoice_date`, never stored), `collection_status` (`pending`/`partial`/`collected`/`overdue`), `due_date`, `dunning_level` (0-3, informational only — no automatic dunning letters, that's real AR automation this plan explicitly doesn't need to build on day one), `journal_entry_id` FK.
- `post_customer_invoice()`:
  ```
  Debit: AR control GL = total_amount
  Credit: Revenue GL = invoice_amount
  Credit: GST Output GL = gst_amount
  ```
- Collection posts the mirror entry (`Debit: Bank, Credit: AR`), with early-payment discount handled the same shared function as Part C where applicable.

## Part E — Payroll Posting (Phase 5, HR integration)

- Reads [[hr]]'s payroll data (once HR gains a payroll concept — today HR only has directory/org-chart fields per `HR_MODULE_PLAN.md`; **this phase is blocked on HR actually producing payroll figures**, which is currently out of HR's own scope since ADP owns payroll per `PRODUCT.md`. Flag this explicitly rather than silently building against data that doesn't exist: either HR's scope also needs to expand to originate payroll numbers, or this phase ingests a payroll export file/CSV from ADP as its input instead of an internal HR table. **Confirm which before building Phase 5.**
- Once the input exists, `post_payroll()` posts the multi-line entry shown in the reference material (Debit Salary Expense, Credit Bank/PF Payable/IT Payable/PT Payable), with a verification step first (gross = deductions + net, PF % check) before posting is allowed.

## Part F — Production Cost Integration (Phase 6)

- Reads [[production]]'s Phase 3.5 (material cost, labor cost, total actual cost per production order — see `PRODUCTION_MODULE_PLAN.md`) and posts WIP/settlement entries: material issue → Debit WIP/Credit Raw Material; labor confirmation → Debit WIP/Credit Payroll clearing; goods receipt of finished good → Debit FG Inventory/Credit WIP, with the standard-vs-actual variance recorded for read-only display (not a separate posted variance account unless real demand for cost-element-level variance reporting emerges).
- This is the one phase that makes Production's Phase 3.5 numbers *real* (posted, reconciled) rather than just a display estimate — sequence Production's Phase 3.5 before this phase.

## Part G — Exception Handling (cross-cutting, build alongside Phases 2-4)

These are validation/workflow rules, not new tables — implement each as a check in the relevant `service.py` function, with the user-facing behavior exactly as scoped:

1. **Out-of-balance JE**: reject at the API layer (400) if `sum(debit) != sum(credit)` on any line set before `INSERT` — never let an unbalanced JE reach `draft` status in the DB. Frontend shows a running balance/difference indicator (green when zero, red otherwise) and disables Submit while red.
2. **Duplicate invoice detection**: before creating a `VendorInvoice`, check for an existing row with the same `(vendor_id, invoice_number, invoice_date)` (exact match → hard block with a link to the existing record) and a fuzzy match on amount within 1% (soft warning, reviewable, not blocked).
3. **3-way match variance approval**: outside tolerance, the invoice is created with `matching_status="variance"` and cannot be posted (`post_vendor_invoice()` refuses) until a Finance Manager (a role/permission check, not just `require_app_access("accounts")`) calls an explicit `approve_variance()` action, which records who approved, when, and why, then posts.
4. **Period lock**: `GLBalance.is_locked` (and by extension the whole `accounting_period`) blocks new postings once set. Unlocking requires a distinct elevated permission (the reference material's "only CEO can unlock" — implement as a specific role check, e.g. `role == "admin"` plus a documented convention that only Finance leadership actually uses it) and always records an `AuditLog` entry with the unlock reason.
5. **Bank reconciliation**: `BankReconciliation` (`bank_reconciliations`): `bank_account_id`, `statement_date`, `statement_balance`, `gl_balance`, computed `outstanding_cheques`/`deposits_in_transit` (both derived from unreconciled `PaymentTransaction` rows, not separately entered), `reconciled_balance`, `status`. A cheque/payment only leaves the "outstanding" list once explicitly marked reconciled against a bank statement line — never automatically.
6. **Overpayment/reversal**: any correction is **always** a new reversing `JournalEntry` referencing the original (never edit or delete a posted JE) — `reversal_date`/`reversal_reason`/`reversed_by_id` on the original, plus a fresh corrected entry. This preserves the audit trail exactly as the reference material's 3-JE reversal pattern shows.
7. **GL account validation**: the GL account field on every form is a constrained dropdown/searchable-select (per [[premnathrail-ui-behavior]]'s `SearchableSelect` convention) sourced from `active` `GLAccount` rows only — never a free-text field, so "GL account not found" becomes structurally impossible rather than a runtime error to catch.

## Part H — Reporting & Period Close (Phase 7)

- Trial Balance view (per-GL-account opening/debit/credit/closing for a period) — the real version of what `ACCOUNTS_MODULE_PLAN.md`'s Phase 1 dashboard approximated with read-only joins; this one is backed by actual `gl_balances`.
- AR/AP aging reports — now with real computed `days_outstanding` and tolerance-based statuses, superseding that plan's "aging-shaped" read views.
- Period close checklist/workflow: accruals entry → reconciliation → trial balance generation → lock. Model as a simple `PeriodClose` status record per `accounting_period`, not a rigid workflow engine.

## Build sequencing

1. **Part A** (master data) — must exist before anything else; low risk, mostly additive columns on existing tables plus a few new small ones.
2. **Part B** (ledger engine + the out-of-balance guard from Part G #1) — the load-bearing piece everything else posts through. Get the balance invariant and `GLBalance` recompute right before building any poster on top of it.
3. **Part C (AP)** and **Part D (AR)** can build in parallel once Part B exists — each is a self-contained poster + sub-ledger.
4. **Part G's remaining exceptions** (#2-7) layer onto Parts C/D as they're built, not as a separate later pass — a 3-way match without a variance-approval flow is only half-built.
5. **Part E (Payroll)** — blocked on resolving the HR/ADP data-source question above; don't start until that's answered.
6. **Part F (Production)** — sequence after `PRODUCTION_MODULE_PLAN.md`'s Phase 3.5 lands.
7. **Part H (Reporting/close)** — last, since it's only meaningful once real postings exist to report on.

## Interconnections

| With | Relationship |
|---|---|
| [[purchase-department]] | `VendorInvoice` FKs `P2PPurchaseOrder`; vendor master fields extend `vendor.Vendor` |
| [[business-development]] (CRM) | `ARTransaction` FKs CRM `Organization`/`PurchaseOrder` |
| [[service-commissioning]] | `ARTransaction` can also reference `ServiceRequest` billing |
| [[hr]] | Payroll posting phase, blocked on payroll data source question |
| [[production]] | Cost/WIP posting reads Production's Phase 3.5 computed costs |
| [[store]] | GRN quantities for 3-way match are read from Store/`P2PRequest.received_quantity` |
| Every department (per the integration matrix reviewed) | Any department that produces a cost/revenue event with a GL impact eventually posts through one of this module's `post_*()` functions — Accounts is the single posting authority, never a peer table each department writes to directly |

## Cross-cutting

- Register `"accounts"` in `AVAILABLE_APPS`.
- Every `post_*()` function lives in `backend/app/modules/accounts/service.py`, is the *only* way a `JournalEntry` gets created, and is unit-testable in isolation from the HTTP layer — mirrors the "every stock write goes through `service.py`" rule already established for Store.
- `AuditLog` gets an entry for every posting, reversal, period lock/unlock, and variance approval — no exceptions, this is the module where audit trail matters most.
- Alembic migrations per phase, same defensive-column-check + `batch_alter_table` conventions as everywhere else in this codebase.
