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
    _feature("payment_block", "Block invoices for payment", "action", {
        "view": "view", "edit": "edit",
    }, "Put a vendor invoice on payment block (or release it) so payment runs skip it."),
    _proof("a payment or receipt voucher (bill, bank advice / UTR)"),
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
