"""Finance → Settings on the shared settings framework
(app/core/settings_framework.py). Only the values Finance code reads.

Editing needs admin or an explicit `accounts:settings:edit` grant."""
from app.core.settings_framework import ModuleSettingsDef, SettingSpec, register_module_settings, get_setting as _get

MODULE = "accounts"

ACCOUNTS_SETTING_GROUPS = {
    "settlement": "Receipts & payment differences",
    "approval": "Payment approval",
    "credit": "Credit management",
    "dunning": "Collections & dunning",
    "proof": "Supporting documents",
    "invoice_match": "Invoice match tolerances (3-way match per PO line)",
}

_SPECS = [
    SettingSpec("receipt_writeoff_approval_limit", "settlement", "Write-off approval limit (₹)", "decimal", 1000, min=0,
                help="A customer receipt whose deductions (LD, penalty, short payment, rounding, other) add up to MORE "
                     "than this waits for approval (Finance approver, then a Partner) before it is posted. Bank charges "
                     "and deductions up to the limit post at once. 0 = every receipt with a deduction needs approval."),
    SettingSpec("small_difference_tolerance", "settlement", "Small-difference tolerance (₹)", "decimal", 10, min=0, max=1000,
                help="A standalone write-off (no cash) of a residual up to this amount may be posted by any Finance user "
                     "with Payments → Edit; above it, the write-off needs a Finance Manager."),
    SettingSpec("expense_payment_approval_limit", "approval", "Expense payment approval limit (₹)", "decimal", 0, min=0,
                help="Expense payment vouchers above this amount wait for approval like vendor payments. 0 = expense "
                     "payments post at once (vendor payments always need approval)."),
    SettingSpec("credit_check_at_dispatch", "credit", "Credit check at dispatch", "bool", True,
                help="A Store dispatch to a customer who is over their credit limit (CRM organisation) or has invoices "
                     "overdue beyond their credit days is blocked until a Finance approver releases it (Finance › "
                     "Outstanding › Credit)."),
    SettingSpec("credit_overdue_grace_days", "credit", "Overdue grace (days)", "int", 0, min=0, max=365,
                help="An invoice blocks credit only when it is overdue by MORE than this many days past its due date "
                     "(invoice date + the customer's credit days). Disputed amounts never block."),
    SettingSpec("credit_release_validity_days", "credit", "Credit release valid for (days)", "int", 7, min=1, max=90,
                help="Once a Finance approver releases a credit block, the order / dispatch may go ahead for this many days."),
    SettingSpec("dunning_level1_days", "dunning", "Reminder level 1 after (days overdue)", "int", 7, min=1, max=365),
    SettingSpec("dunning_level2_days", "dunning", "Reminder level 2 after (days overdue)", "int", 30, min=1, max=365),
    SettingSpec("dunning_level3_days", "dunning", "Final notice (level 3) after (days overdue)", "int", 60, min=1, max=730,
                help="The dunning run raises an invoice to the highest level whose day count it has passed. Disputed "
                     "amounts are left out."),
    SettingSpec("dunning_min_amount", "dunning", "Minimum overdue to remind (₹)", "decimal", 1000, min=0,
                help="Customers whose undisputed overdue total is below this get no reminder letter."),
    SettingSpec("proof_required_purchase_invoice", "proof", "Vendor bill compulsory on purchase invoices", "bool", True,
                help="A purchase invoice can't be submitted or approved until the vendor's bill (PDF / photo) is attached. "
                     "The bill copy is what defends the GST input credit in an audit. Opening-balance bills are exempt."),
    SettingSpec("proof_required_journal", "proof", "Working compulsory on manual journals", "bool", True,
                help="A manual journal can't be submitted or approved until its working or approval note is attached — "
                     "manual journals are where errors and fraud enter the books."),
    SettingSpec("proof_required_payment", "proof", "Proof compulsory on payments & receipts", "bool", False,
                help="Vendor payments, customer receipts, expense payments and other receipts above the amount below "
                     "can't be saved without a supporting file (bill, bank advice / UTR). Contra transfers are exempt."),
    SettingSpec("proof_required_payment_above", "proof", "Payment proof needed above (₹)", "decimal", 0, min=0,
                help="Used only when the switch above is on: vouchers above this amount need a file. 0 = every voucher."),
    # Read by accounts/services/po_match.py. Moved here from Procurement › Settings on
    # 2026-11-14: checking a vendor bill against its PO is a Finance control, so a
    # buyer does not set the slack for checking their own POs.
    SettingSpec("invoice_qty_tolerance_pct", "invoice_match", "Quantity tolerance (%)", "decimal", 2.0, min=0, max=50,
                help="A bill line may invoice up to this % more than was received (and not yet invoiced) on its PO line "
                     "before it is held as a variance for Finance Manager approval."),
    SettingSpec("invoice_price_tolerance_pct", "invoice_match", "Price tolerance (%)", "decimal", 1.0, min=0, max=50,
                help="A bill line's rate may differ from the PO line's rate by up to this % (either way)."),
    SettingSpec("invoice_price_tolerance_abs", "invoice_match", "Price tolerance cap (₹ per line)", "decimal", 500.0, min=0, max=10000000,
                help="Even inside the % tolerance, a line whose price difference (rate difference x quantity) is more "
                     "than this amount is held as a variance. 0 = no cap."),
]

register_module_settings(ModuleSettingsDef(
    module_key=MODULE, label="Finance & Accounting",
    specs={s.key: s for s in _SPECS}, groups=ACCOUNTS_SETTING_GROUPS,
))


def get_setting(db, key: str):
    return _get(db, MODULE, key)
