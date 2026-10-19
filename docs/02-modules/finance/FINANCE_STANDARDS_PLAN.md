# Finance & Accounting — Standards Upgrade Plan (2026-10-06)

Builds on the existing `backend/app/modules/accounts/` module (ledger engine, AP 3-way match,
AR, payments, period close, bank reconciliation, reports — see `old_docs/product/ACCOUNTS_MODULE_ROADMAP.md`).
Nothing that works is rebuilt; every phase below either **fixes** a gap against accounting
standards or **adds** a missing area from the requested scope.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Inventory accounting | **Periodic (Tally-style)** | Purchases post to *Purchase Accounts*; at period end a closing-stock valuation from Store is posted and auto-reversed on day 1 of the next period. GL and Store agree at period end, not continuously. |
| E-invoice / e-way bill | **Fields only, no IRP/GSP API** | Turnover vs the ₹5 cr threshold is unconfirmed. IRN, Ack No/Date and e-way bill no/date are captured on sales invoices so an API integration can be added later without schema change. |
| TDS / TCS | **Out of scope** | Vendors are paid gross. The seeded *TDS Payable* ledger stays for manual journals. |
| Party ledgers | **Sub-ledger + control account (SAP standard)** | Vendors (Accounts master) and customers (CRM Organizations) are sub-ledgers posting through the *Sundry Creditors / Sundry Debtors* control accounts — not one GL ledger per party (Tally style). Party balances come from open items, the control account always equals the sum of them. |
| Money columns | **`Numeric(18,2)`** (read back as float) | Float cannot store 0.1 exactly; a ledger must never drift by paise. |

## Standards gaps found in the existing module (fixed in Phase 1)

1. **Balances do not carry forward.** Every new month's `GLBalance` started with opening 0 and
   `GLAccount.opening_balance` never entered the ledger — Trial Balance and Balance Sheet for any
   month after the first showed only that month's movement. Fix: opening = prior closing, back-dated
   postings roll forward into later periods, a rebuild function recomputes from journal lines, and
   opening balances are posted as an *Opening Balance* voucher (the only auditable way).
2. **Voucher numbers by calendar year.** Indian books run on the financial year (Apr–Mar). Fix:
   numbering per voucher type per FY — `JV/2026-27/0001`, `PV/…`, `RV/…`, `CV/…`, `PI/…`, `SI/…`,
   `DN/…`, `CN/…` — and postings refused outside an open financial year / before its lock date.
3. **Flat chart of accounts.** Fix: an *Account Group* hierarchy (Capital Account, Current Assets →
   Sundry Debtors, Duties & Taxes, Purchase Accounts, Direct/Indirect Expenses …) mapped to
   Schedule III heads, so reports group correctly.
4. **Hard-coded ledger codes for automatic postings.** Fix: an *Account Determination* settings
   record (which ledger is AP control, CGST input, round-off, closing stock …), seeded with defaults.
5. **Manual journals post immediately.** Fix: draft → posted by a *different* user (maker-checker),
   same rule already used for vendor invoices.
6. **Postgres-only SQL in period close** (`to_char`) — replaced with date-range filters.
7. **No tests.** Every phase ships with tests.

## Phases

| # | Area (requested scope) | What gets built |
|---|---|---|
| 1 | Company & Financial Year, Chart of Accounts | FY-aware periods + voucher series; balance carry-forward + rebuild; account groups (seeded, Schedule III mapped); account determination settings; cash accounts (`BankAccount.account_kind = bank/cash`); opening-balance voucher; JE draft/approve; money → Numeric. |
| 2 | Tax configuration | GST rate master (seeded 0/5/18/40 active; 12/28 inactive, pre-22-Sep-2025 slabs); state-code master; split GST ledgers (CGST/SGST/IGST × Input/Output, RCM payable); place-of-supply engine (company GSTIN state vs party state → CGST+SGST or IGST). |
| 3 | Purchase | Line-item purchase invoices (PO-linked with existing 3-way match, or direct for services/expenses); HSN/SAC + GST rate per line; RCM; round-off; due date stored; **Debit notes** (purchase returns) with GST reversal. |
| 4 | Sales | Line-item sales invoices (HSN, qty, rate, discount, GST rate), place of supply, billing/shipping, e-invoice/e-way bill fields; **Credit notes** (sales returns). |
| 5 | Payments & Receipts | One voucher model for *vendor payment, customer receipt, expense payment, other receipt, contra*; bill-wise allocation across many invoices/notes; on-account advances and later allocation. |
| 6 | Bank & Cash | Bank book / cash book from the GL; bank reconciliation by bank (clearing) date for every voucher; BRS statement; book balance taken from the GL — the stored `current_balance` is no longer a second source of truth. |
| 7 | GST & Tax | GST input/output register, GSTR-1 (B2B, B2CL, B2CS, CDNR, HSN summary), GSTR-3B summary, GST set-off voucher (utilisation order per CGST Rule 88A). |
| 8 | Accounts Receivable / Payable | Party-wise outstanding with due dates and overdue days, aging per party, party ledger statement, allocation (payment tracking) history. |
| 9 | Inventory Accounting | Stock valuation from Store (on-hand × moving-average, standard as fallback) by category; purchase/sales impact by item; closing-stock voucher with auto-reversal. |
| 10 | Journal Entries — Adjustments | Voucher sub-types adjustment/accrual/correction/depreciation; auto-reversing accruals; fixed-asset register (SLM/WDV, Companies Act) with a monthly depreciation run and disposal. |
| 11 | Financial Reports | Trial Balance (date range, grouped), P&L and Balance Sheet in Schedule III format (Cost of materials consumed = opening stock + purchases − closing stock), Cash Flow (indirect method, AS-3), Day Book, ledger statement, outstanding reports. |
| 12 | Year-end | Year-end close voucher transferring P&L to Retained Earnings; FY close. |

## Where each phase lives (implemented 2026-10-06, migration `a8c3e5f7b9d1`)

| Phase | Backend | Frontend (`dashboard/finance/…`) |
|---|---|---|
| 1 | `services/fiscal.py`, `services/balances.py`, `services/ledgers.py`, `services/opening.py`, `models/account_group.py`, `models/settings.py`, `service.py` (engine), `routes/account_setup.py`, `routes/journal_entries.py` | `masters`, `ledger` |
| 2 | `services/gst.py`, `models/settings.py` (`GSTRate`) | `masters` → GST Rates |
| 3 | `service.py` (purchase invoices), `services/notes.py`, `routes/vendor_invoices.py`, `routes/party_notes.py` | `purchase` |
| 4 | `service.py` (sales invoices), `services/notes.py`, `routes/ar_transactions.py` | `sales` |
| 5 | `services/vouchers.py`, `routes/payments.py` | `payments` |
| 6 | `service.py` (bank reconciliation), `routes/bank_reconciliations.py`, `routes/bank_accounts.py` | `banking` |
| 7 | `services/gst_returns.py`, `routes/gst.py` | `gst` |
| 8 | `services/outstanding.py`, `routes/outstanding.py` | `outstanding` |
| 9 | `services/inventory.py`, `routes/inventory_accounting.py` | `inventory` |
| 10 | `services/assets.py`, `routes/fixed_assets.py`, accruals in `service.py` | `assets`, `ledger` |
| 11 | `reports.py`, `routes/reports.py` | `reports` |
| 12 | `services/closing.py` (year-end routes in `routes/reports.py`) | `reports` → Year-end Close |

Tests: `backend/app/tests/test_accounts_finance.py`.

## Month-end checklist (the order the module expects)

1. Post or cancel every pending purchase/sales invoice, note and draft journal dated in the month.
2. Bank reconciliation for each bank account to the month-end statement.
3. Accruals (journal type *accrual*, auto-reverse on the 1st).
4. Depreciation run for the month (Assets).
5. Closing-stock valuation (Inventory) — counts corrected, then posted.
6. GST: check GSTR-1 / GSTR-3B, post the ITC set-off, pay the cash portion (Payments → Expense payment to the output ledgers).
7. Review Trial Balance → P&L → Balance Sheet → Cash Flow; then close the period (Journals → Period Close).
8. At 31 March, after the above: Reports → Year-end Close.

## Cross-cutting rules (unchanged, still enforced)

- `post_journal_entry()` is the only function that creates a journal entry.
- Posted vouchers are never edited or deleted — reversal or a note (debit/credit) only.
- Maker-checker: whoever records an invoice/journal cannot post or pay it.
- Every posting, reversal, approval, period lock/unlock is written to `AuditLog`.
- Every validation error states the real reason and the fix.
