# Finance — audit 2026-10-27

## High
1. **A manual journal can debit or credit a bank/cash ledger.** This bypasses payment approval, the cash-negative check and the proof rule, and the bank reconciliation can never tick the line (accounts/service.py:94-136).
2. **Expense payments and contras post with no second person by default.** The limit defaults to 0, and 0 means "never needs approval" (routes/payments.py ~236, settings.py:25).
3. **Year-end close does not need the March closing stock or a clear approval queue.** Profit goes wrong and the valuation can't be posted after the close (services/closing.py:50-65).

## Medium
4. A cancelled purchase bill blocks re-entry of the same bill number, because the unique constraint includes cancelled rows (models/vendor_invoice.py:32).
5. Debit/credit note GST is not tied to the original invoice: any rate is allowed, and more GST than was charged can be reversed (services/notes.py:84-94).
6. Closing-stock line edits are not audited, the same person can edit and post, and there is no cost/NRV check (inventory_accounting.py:56, services/inventory.py:122-150).
7. Vendor bank details are visible to every Procurement user (routes/vendors.py:56-104).
8. A vendor's bank account can be changed with no approval or alert, which is the classic payment-diversion fraud route (vendors.py:65-158).
9. There is no duplicate GSTIN/PAN check on vendors, so the same supplier can exist twice and the same bill can be paid twice.
10. A PO bill falls back to matching the vendor by name (ILIKE) (service.py:436-450).
11. Releasing a settlement hard-deletes the allocation history (services/vouchers.py:~771).
12. GL ledger and bank account create, edit and delete are not audited (gl_accounts.py, bank_accounts.py).
13. Transaction lists silently cut off at 500 rows and are sorted newest first.
14. Closing the year fails if March is already closed (closing.py:84) (verify).

## Low
15. "Collect against invoice" skips the payment-proof rule.
16. The IRN and e-way bill can be overwritten or blanked after issue, and the audit has no old value.
17. Sales invoice numbers follow the approval order, not the invoice date (verify).
18. GST rounding uses float round() (half-even) instead of Decimal half-up.
19. No lock when a journal line settles bills, so it can be over-allocated.
20. No lock between closing a period and posting into it (verify).
21. GSTR-3B puts 0% exports in the nil-rated row instead of zero-rated (verify).
22. Role editor groups don't match the Finance tabs (rule 17).
23. Vendor catalogue price and minimum order quantity are Float.

Clean: balanced journals, period/FY locks, voucher series lock, reverse-only, maker-checker, NUMERIC money, allocation row locks, permissions, F821, dialogs, select, signed links, gear.
