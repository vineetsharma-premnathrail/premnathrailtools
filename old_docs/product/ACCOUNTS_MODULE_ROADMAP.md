# Finance & Accounting Module — Phased Roadmap (high-level)

> Companion to `ACCOUNTS_DEPARTMENT_MODULE_PLAN.md` (the detailed original design). This is that plan reconciled against what the codebase actually looks like today (some pieces have since been partially built under a different module), re-cut into phases mapped against a specific requested feature list. Read the detailed plan for full field-level design; read this for phase boundaries, what already exists, and dependency order.

## Context

Scope requested: GL creation/posting, AR, AP, period closing, payments, cost centers, internal orders, P&L/variance analysis, cash management, bank reconciliation, liquidity forecast, GL reports, monthly reports. This is effectively a parallel double-entry ledger (like SAP FI/CO) — too large to design or build in one pass, so this is a **roadmap**, not a detailed implementation plan: phase boundaries, what already exists, what's genuinely new, and dependency order. A detailed file-by-file plan should be requested per-phase when that phase is actually started.

## What already exists today (don't rebuild)

- **`backend/app/modules/organization/models/cost_center.py` + `routes/cost_center.py`** — a simple Cost Center *master list* already exists (code, name, branch, department, manager, parent, effective dates). It has **no budget, GL-account link, or actuals/variance fields** — the detailed plan's `CostCenter` envisioned those. Decision for Phase 1: **extend this existing table** (add `annual_budget`, `budget_period`, `gl_account_id`) rather than create a competing `accounts.CostCenter` — same "extend, don't duplicate" precedent the detailed plan already used for Vendor/Organization.
- **`backend/app/modules/organization/models/company_financial_year.py`** — gives per-company Fiscal Year (`start_date`/`end_date`/`status`/`lock_date`/`period_closing_rule`) but no per-month "Period" entity yet — Phase 2/5 will need to add that.
- **`Company`/`Branch` models** already carry `currency`, GSTIN/PAN/TAN/CIN, `default_cost_center`/`default_profit_center` — usable as-is by GL posting logic, no changes needed there.
- **Frontend scaffold** — `frontend/src/app/dashboard/finance/{ledger, ar-ap, banking, masters, reports, budgets, expenses, assets}/` already exist as empty placeholder folders. `budgets`/`expenses`/`assets` (fixed assets) are **not** in the current ask — flagging them as pre-scaffolded but out of scope for now, not something to design here.
- **No GL/journal/invoice/payment code exists anywhere else** — P2P's `P2PPurchaseOrder` has `total_value`/`line_total` but no GL account, debit/credit, or posting concept. This module is genuinely greenfield beyond the two files above.

## Module shape

New backend module `backend/app/modules/accounts/` (`models/`, `routes/`, `schemas/`, `service.py`) following this codebase's standard module layout ([[premnathrail-app-design]]). Register `"accounts"` in `AVAILABLE_APPS`. Frontend lives under the existing `dashboard/finance/` scaffold. **Every posting is a `post_*()` function in `accounts/service.py` — the only way a `JournalEntry` is ever created; no generic "create arbitrary JE" endpoint.** This single-posting-authority rule is the load-bearing architectural decision for the whole module.

## Phases (mapped to the requested feature list)

**Phase 1 — Master Data.** `GLAccount` (chart of accounts — code, name, type, posting/control-account flags), `BankAccount`, extend the existing `CostCenter` (budget + GL link), new `InternalOrder`, extend `Vendor`/CRM `Organization` with bank/GL-reconciliation fields. Low risk, mostly additive. *Blocked on getting the real chart of accounts from whoever owns SAP FI today — don't invent one.*

**Phase 2 — Ledger Engine** *(covers "GL creation, create/post financial accounting")*. `JournalEntry` + `JournalEntryLine` + `GLBalance` (materialized, recomputed from lines — same pattern as Store's `StockBalance`). Hard invariant: debit == credit, enforced server-side before any insert, never a stored imbalance. This is the piece everything else posts through — get it right before building anything on top.

**Phase 3 — Accounts Payable** *(covers "account payable", "payments")*. `VendorInvoice` against `P2PPurchaseOrder`, 3-way match (PO/GRN/Invoice qty+amount) with tolerance-based auto-match vs. variance-approval hold, `post_vendor_invoice()`, then `PaymentTransaction` for vendor payments (cheque/NEFT/RTGS/cash) with early-payment-discount handling.

**Phase 4 — Accounts Receivable** *(covers "account receivable")*. `ARTransaction` against CRM `Organization`/sales references, `post_customer_invoice()`, collections posting the mirror entry. Can build in parallel with Phase 3 once Phase 2 exists.

**Phase 5 — Period Closing** *(covers "period closing"; layers onto Phases 3-4 as they're built, not after)*. Period lock on `GLBalance` (blocks new postings once locked, elevated-permission unlock only, always audit-logged), duplicate-invoice detection, reversal-only corrections (never edit/delete a posted JE).

**Phase 6 — Cash Management** *(covers "cash management, bank reconciliation, liquidity forecast")*. `BankReconciliation` against bank statements (outstanding cheques/deposits-in-transit derived from unreconciled payments, never hand-entered). **Liquidity forecast is genuinely new** (not in the detailed plan) — a projected cash position built from `BankAccount.current_balance` + open `ARTransaction`/`VendorInvoice` due dates; scope this as a read-only projection view, not a new stored table.

**Phase 7 — Management Reporting & Analysis** *(covers "P&L analysis, Variance Analysis, GL reports, financial analysis, monthly reports"; last, since it's only meaningful once real postings exist)*. Trial Balance / GL account reports off real `GLBalance` data, AR/AP aging, a P&L statement (revenue/expense GL rollup by period), Variance Analysis (cost center/internal order budget vs. actual — `InternalOrder.actual_amount`/`variance` computed at read time from JE lines, never stored), and a monthly close report pack tying the above together.

**Deferred / explicitly blocked** — Payroll posting (blocked until HR/ADP produces real payroll figures — flag and confirm before starting) and Production cost/WIP integration (sequence after Production's own cost-tracking phase lands, if/when that module exists).

## Cross-cutting rules (apply from Phase 2 onward)

- Reversal-only corrections, never edit a posted JE.
- `AuditLog` entry for every posting, reversal, period lock/unlock, and variance approval.
- GL account fields are always a constrained searchable-select sourced from active `GLAccount` rows — never free text.
- Alembic migrations per phase, defensive column checks + `batch_alter_table`, same as every other migration in this repo.

## Open questions to resolve before Phase 1 starts

1. Real chart of accounts source (who owns it today — SAP FI config?).
2. Who counts as "Finance Manager" for variance-approval — a new role/permission flag, or reuse of an existing one?
3. Tolerance thresholds for 3-way match (detailed plan's defaults: 2% qty, 1% amount) — confirm these are acceptable or need different numbers.
4. Whether `budgets`/`expenses`/`assets` (already-scaffolded frontend folders) are meant to be a near-term Phase 8+ or are unrelated/stale scaffolding.

## Next step

This roadmap is intentionally high-level. When ready to start building, request a detailed implementation plan on a single phase (Phase 1 is the natural starting point — everything else depends on it) and that will get the full file-by-file treatment this roadmap deliberately skipped.
