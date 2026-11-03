"""Finance & Accounting features, PART A — Journals, Masters, Payments
(vouchers, runs, advances), Purchase, Sales and Reports. See
permission_registry.FEATURES. (Banking, assets, controlling, outstanding, GST,
currencies, inventory, costing … live in accounts_b.py.)

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Record-level rules stay on top: maker-checker (no self
posting), Finance Manager for reversals / GST / opening balances, the
approval engine, and data scope. Period close / year-end close have no
features: closing is the tab's approve and reopening is admin-only."""
from app.core.permission_registry import _feature, register_features
from app.core.visibility import register_visibility
from app.modules.accounts.models.payment_transaction import PAYMENT_MODES, PAYMENT_TYPES
from app.modules.accounts.models.vendor import GST_REGISTRATION_TYPES, VENDOR_STATUSES


def _proof(what: str) -> tuple:
    """Supporting documents (voucher proof) on one Finance document type."""
    return _feature("proof", "Supporting documents", "section", {
        "view": "view", "create": "create", "delete": "delete",
    }, f"Files behind {what}: see / open them, upload, and delete your own while the document is still unposted.")


# ── Journals ─────────────────────────────────────────────────────────────

register_features(
    "accounts", "journal_vouchers",
    _feature("reversal", "Reverse posted journals", "action", {
        "view": "view", "cancel": "reject",
    }, "Reverse a posted journal with a reason (a mirror entry is posted). The user must also be a Finance Manager."),
    _feature("change_history", "Change history", "section", {
        "view": "view",
    }, "The change log of a posted voucher (narration / remark edits, posting and reversal events) on the voucher page."),
    _proof("a manual journal (working, approval mail)"),
)


# ── Purchase ─────────────────────────────────────────────────────────────

register_features(
    "accounts", "purchase_invoices",
    _feature("variance_approval", "Approve 3-way-match variance", "action", {
        "view": "view", "approve": "approve",
    }, "Accept a price / quantity difference between the PO, GRN and vendor invoice so the invoice can be posted."),
    _feature("settlements", "Payments against the invoice", "section", {
        "view": "view",
    }, "The payments, advances and debit notes settled against a purchase invoice."),
    _proof("a purchase invoice (the vendor's bill)"),
)

register_features("accounts", "debit_notes", _proof("a debit note (vendor's note, rejection report)"))

# ── Sales ────────────────────────────────────────────────────────────────

register_features(
    "accounts", "sales_invoices",
    _feature("bill_from_so", "Bill from sales order", "action", {
        "view": "view", "create": "create",
    }, "See the sales orders due for billing and raise an invoice from a billing milestone / dispatch."),
    _feature("e_invoice", "E-invoice details", "action", {
        "view": "view", "edit": "edit",
    }, "Record the e-invoice IRN, acknowledgement and e-way bill details on a sales invoice."),
    _feature("settlements", "Receipts against the invoice", "section", {
        "view": "view",
    }, "The receipts, advances and credit notes settled against a sales invoice."),
    _proof("a sales invoice (customer PO, signed delivery copy)"),
    _feature("billing_due", "Billing Due tab", "subtab", {
        "view": "view",
    }, "The Billing Due sub-tab of Finance › Sales: historic sales-order billing milestones waiting for an invoice. "
       "Raising the invoice from it also needs Bill from sales order."),
)

register_features("accounts", "credit_notes", _proof("a credit note (customer's debit note, return proof)"))

# ── Payments ─────────────────────────────────────────────────────────────

register_features(
    "accounts", "payments",
    _feature("allocation", "Allocate payments to bills", "action", {
        "view": "view", "edit": "edit",
    }, "Knock an on-account payment / advance off against open invoices, or undo an allocation."),
    _feature("write_offs", "Write-offs & short payments", "action", {
        "view": "view", "create": "edit", "cancel": "reject",
    }, "Write off a small balance or record a short-payment deduction (TDS, bank charges, discount), and cancel one."),
    _feature("cancellation", "Cancel payment vouchers", "action", {
        "view": "view", "cancel": "reject",
    }, "Cancel a posted payment / receipt / contra voucher with a reason (its GL entry is reversed)."),
    # payment_block ("Block invoices for payment") removed 2026-11-03: no screen uses it (retired id;
    # PATCH /accounts/vendor-invoices/{id}/payment-block now checks Payments › Edit).
    _proof("a payment or receipt voucher (bill, bank advice / UTR)"),
    _feature("advances", "Advances & write-offs page", "subtab", {
        "view": "view",
    }, "The Advances & write-offs page (button on Finance › Payments): open advances to adjust and the write-off list. "
       "Adjusting needs Allocate payments to bills; write-offs need Write-offs & short payments."),
)

register_features(
    "accounts", "payment_runs",
    _feature("execution", "Execute payment runs", "action", {
        "view": "view", "create": "create",
    }, "Execute an approved payment run: post the payment vouchers for every line."),
    _feature("bank_file", "Download bank payment file", "action", {
        "view": "view", "export": "export",
    }, "Download the bank upload file (beneficiary account numbers and amounts) of a payment run."),
)

# ── Masters ──────────────────────────────────────────────────────────────

register_features(
    "accounts", "vendors",
    _feature("bank_details", "Vendor bank details", "section", {
        "view": "view", "create": "create", "edit": "edit",
    }, "See, enter and change a vendor's bank name, account number, IFSC and account holder. Changing them is a classic payment-fraud route, so grant edit carefully."),
)

# ── UI visibility per role (core/visibility.py) ─────────────────────────
# What a member of a role sees on the Vendor form / list and the New voucher
# form / vouchers list. Dropdown values are the coded ones (never retyped); a
# value a role does not allow is also refused by the server (routes/vendors.py,
# routes/payments.py). Sections holding a required field are locked. Money
# columns are not offered: every Finance tab is money by nature and the amount
# columns stay. Hiding a section or column is on screen only.


def _labelled(values: tuple, labels: dict[str, str]) -> dict[str, str]:
    """Every coded value with its screen label; a value without a label is a bug, not a silent gap."""
    missing = [v for v in values if v not in labels]
    assert not missing, f"visibility: no label for {missing}"
    return {v: labels[v] for v in values}


GST_REGISTRATION_LABELS = {"regular": "Regular", "composition": "Composition", "unregistered": "Unregistered",
                           "overseas": "Overseas (import)", "sez": "SEZ"}
VENDOR_STATUS_LABELS = {"active": "Active", "inactive": "Inactive", "blocked": "Blocked"}
# 'employee' is a legacy, reserved type the form never offers.
VOUCHER_TYPE_LABELS = {"vendor": "Vendor payment", "customer": "Customer receipt", "expense": "Expense payment",
                       "other_receipt": "Other receipt", "contra": "Contra (bank / cash transfer)"}
PAYMENT_MODE_LABELS = {"cheque": "Cheque", "neft": "NEFT", "rtgs": "RTGS", "imps": "IMPS", "upi": "UPI", "cash": "Cash",
                       "dd": "Demand Draft"}

register_visibility(
    "accounts", "vendors",
    label="Vendors — form & list",
    screens=(("form", "Vendor form"), ("list", "Vendors list")),
    sections=(
        ("vendor", "Vendor", "Code, name and status.", True, "form"),
        ("gst_pan", "GST & PAN", "GST registration, GSTIN (required for registered vendors) and PAN.", True, "form"),
        ("address", "Address", "Address, city, state (place of supply) and PIN.", False, "form"),
        ("contact", "Contact", "Contact name, phone and email.", False, "form"),
        ("referral", "Referred by", "How the vendor came to us — required for a new vendor.", True, "form"),
        ("bank_details", "Bank details", "Bank name, account number, IFSC and account holder. On screen only — the "
         "'Vendor bank details' feature decides whether the numbers are sent at all.", False, "form"),
        ("terms", "Terms & posting", "Credit limit, payment days and the default expense ledger.", False, "form"),
    ),
    options=(
        ("gst_registration_type", "GST registration", _labelled(GST_REGISTRATION_TYPES, GST_REGISTRATION_LABELS),
         "Registration types a role may give a vendor. A value not allowed here is also refused by the server. "
         "Vendors added from Procurement follow their own rules.", "form"),
        ("status", "Vendor status", _labelled(VENDOR_STATUSES, VENDOR_STATUS_LABELS),
         "Statuses a role may set (e.g. only Active — no blocking). Keep Active allowed for roles that create vendors. "
         "Vendors added from Procurement follow their own rules.", "form"),
    ),
    tables=(
        ("vendors", "Vendors list", {"gst_type": "GST type", "gstin": "GSTIN", "city_state": "City / State",
                                     "payment_days": "Payment days", "referred_by": "Referred by", "created_by": "Created by"}, "list"),
    ),
)

register_visibility(
    "accounts", "payments",
    label="Payments & Receipts — voucher form & list",
    screens=(("form", "New voucher form"), ("list", "Vouchers list")),
    sections=(
        ("voucher", "Voucher", "Voucher type, party, date and amount.", True, "form"),
        ("bank_mode", "Bank & mode", "Bank / cash account, payment mode, cheque and reference details.", True, "form"),
        ("advance", "Advance (down payment)", "The 'this is an advance' switch with its purchase order / reason.", False, "form"),
        ("narration", "Narration", "Free-text narration on the voucher.", False, "form"),
        ("documents", "Supporting documents", "Bill / bank advice — required above the limit in Finance Settings.", True, "form"),
        ("summary", "Summary", "The running totals box (voucher amount, allocated, on account).", False, "form"),
    ),
    options=(
        ("payment_type", "Voucher type", _labelled(tuple(t for t in PAYMENT_TYPES if t != "employee"), VOUCHER_TYPE_LABELS),
         "Voucher types a role may record (e.g. receipts only). A type not allowed here is also refused by the server.", "form"),
        ("payment_mode", "Payment mode", _labelled(PAYMENT_MODES, PAYMENT_MODE_LABELS),
         "Modes a role may pick. Keep Cash allowed for roles that post from the cash box. "
         "Payment runs and payments made from other screens follow their own rules.", "form"),
    ),
    tables=(
        ("vouchers", "Vouchers list", {"type": "Type", "party": "Party / ledgers", "bank": "Bank / cash", "mode": "Mode / ref",
                                       "bank_reco": "Bank reco"}, "list"),
    ),
)
