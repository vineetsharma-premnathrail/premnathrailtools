"""Finance & Accounting notifiable events, PART A — Journals, Purchase, Sales,
Payments (vouchers, runs) and period / year close (see
core/notification_events.py). Finance B's events live in accounts_b.py.

Fired from app/modules/accounts/access.py (submit_document for the
"waiting for approval" events, the approval-engine on_decided callbacks for
the outcome events) and the period-close / year-end / payment-run routes.
Members must be able to open the record (Finance data scope) to hear about
it. The engine's own direct notices (stage approvers on submit, the
requester on the outcome) are kept; those people are skipped here.
Events raised inside an approval decision have no request background task,
so they go out on bell / Teams only (no email)."""
from app.core.notification_events import register_event

# ── Waiting for a decision ───────────────────────────────────────────────────
register_event(
    "accounts", "journal_submitted", "Journal voucher waiting for approval",
    "a manual journal voucher is submitted for approval (maker-checker)", ("journal_vouchers", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "accounts", "purchase_invoice_submitted", "Purchase invoice waiting for approval",
    "a recorded vendor bill (within 3-way-match tolerance) is submitted for posting approval", ("purchase_invoices", "approve"),
    default_channels=("bell",), kind="approval",
)
register_event(
    "accounts", "purchase_invoice_variance", "Purchase invoice variance waiting for approval",
    "a vendor bill outside 3-way-match tolerance (PO / GRN / invoice differ) is submitted and needs variance approval",
    ("purchase_invoices", "variance_approval", "approve"), default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "accounts", "sales_invoice_submitted", "Sales invoice waiting for approval",
    "a draft sales invoice is submitted to be issued / posted", ("sales_invoices", "approve"),
    default_channels=("bell",), kind="approval",
)
register_event(
    "accounts", "payment_submitted", "Payment voucher waiting for approval",
    "a vendor payment (or a receipt / expense payment above the Finance Settings limit) is held for approval",
    ("payments", "approve"), default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "accounts", "payment_run_submitted", "Payment run waiting for approval",
    "a payment proposal (vendor bills picked for payment) is sent for approval", ("payment_runs", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "accounts", "period_close_requested", "Period close waiting for a Finance Manager",
    "someone asks to close an accounting month and it waits for a Finance Manager's approval", ("period_close", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "accounts", "year_close_requested", "Financial year close waiting for a Finance Manager",
    "someone asks to close a financial year and it waits for a Finance Manager's approval", ("year_end_close", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)

# ── Outcomes / next step ─────────────────────────────────────────────────────
register_event(
    "accounts", "purchase_invoice_posted", "Vendor bill posted — due for payment",
    "a vendor bill is approved and posted to the books, so it now falls due for payment", ("payments", "create"),
    default_channels=("bell",), kind="info",
)
register_event(
    "accounts", "sales_invoice_e_invoice_pending", "Sales invoice issued without e-invoice (IRN)",
    "a sales invoice is issued with no IRN recorded — generate it on the IRP portal and record it",
    ("sales_invoices", "e_invoice", "edit"), default_channels=("bell",), kind="info",
)
register_event(
    "accounts", "payment_run_approved", "Payment run approved — ready to execute",
    "a payment run passes its last approval and can be executed into payment vouchers",
    ("payment_runs", "execution", "create"), default_channels=("bell", "teams"), kind="info",
)
register_event(
    "accounts", "payment_run_executed", "Payment run executed — upload the bank file",
    "a payment run is executed (payment vouchers posted); the bank upload file is ready",
    ("payment_runs", "bank_file", "export"), default_channels=("bell",), kind="info",
)
register_event(
    "accounts", "period_closed", "Accounting period closed",
    "an accounting month is closed — no more vouchers can be posted into it", ("period_close", "view"),
    default_channels=("bell",), kind="info",
)
