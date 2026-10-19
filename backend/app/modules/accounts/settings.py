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
                     "Outstanding › Credit). Sales order confirmation follows Sales › Settings › Credit check."),
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
]

register_module_settings(ModuleSettingsDef(
    module_key=MODULE, label="Finance & Accounting",
    specs={s.key: s for s in _SPECS}, groups=ACCOUNTS_SETTING_GROUPS,
))


def get_setting(db, key: str):
    return _get(db, MODULE, key)
