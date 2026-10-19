"""Finance & Accounting notifiable events, PART B — Bank guarantees, credit
releases, collections & disputes, depreciation, product costing and closing
stock (see core/notification_events.py). Part A's events live in accounts.py.

Fired through app/modules/accounts/role_events_b.py from the guarantee,
receivables, fixed-asset, product-costing and inventory routes, the
guarantee / credit-release approval-engine callbacks, and the daily jobs
(tasks/bank_guarantee_reminders.py, services/collections.py — bell / Teams
only, no email from a job). Data-scoped records (guarantees) are only sent to
members who can open them. People already told directly (stage approvers,
requester, owner, collector) are skipped."""
from app.core.notification_events import register_event

# ── Waiting for a decision ───────────────────────────────────────────────────
register_event(
    "accounts", "guarantee_submitted", "Bank guarantee waiting for approval",
    "a bank guarantee / LC / EMD we are applying for is sent for approval", ("guarantees", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "accounts", "credit_release_requested", "Credit block release requested",
    "a sales order confirmation or dispatch stopped by the credit check asks Finance for a release",
    ("credit_management", "approve"), default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "accounts", "depreciation_requested", "Depreciation run waiting for approval",
    "someone who is not a Finance Manager requests the monthly depreciation run", ("depreciation", "approve"),
    default_channels=("bell",), kind="approval",
)
register_event(
    "accounts", "cost_estimate_marked", "Cost estimate waiting for release",
    "a product cost estimate is marked for release to the standard price", ("product_costing", "approve"),
    default_channels=("bell",), kind="approval",
)

# ── Outcomes / state changes ─────────────────────────────────────────────────
register_event(
    "accounts", "guarantee_approved", "Bank guarantee approved — apply to the bank",
    "a bank guarantee / LC / EMD application is fully approved", ("guarantees", "lifecycle", "edit"),
    default_channels=("bell",), kind="info",
)
register_event(
    "accounts", "guarantee_rejected", "Bank guarantee returned / rejected",
    "an approver returns or rejects a bank guarantee / LC / EMD application", ("guarantees", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "accounts", "guarantee_invoked", "Bank guarantee invoked",
    "the beneficiary invokes (claims) a guarantee — given by us or in our favour", ("guarantees", "view"),
    default_channels=("bell", "teams"), kind="info",
)
register_event(
    "accounts", "credit_release_decided", "Credit release decided",
    "a credit block release is approved or rejected", ("credit_management", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "accounts", "dispute_raised", "Customer dispute raised",
    "a customer disputes an invoice (the amount is held out of collections)", ("disputes", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "accounts", "dispute_resolved", "Customer dispute resolved",
    "a customer dispute is closed (credit note, paid, written off …)", ("disputes", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "accounts", "standard_price_released", "Standard price released",
    "a cost estimate is released and becomes the item's new standard price", ("product_costing", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "accounts", "closing_stock_posted", "Closing stock posted",
    "a month-end closing-stock valuation is posted to the ledger", ("inventory", "closing_stock", "view"),
    default_channels=("bell",), kind="info",
)

# ── Reminders (daily jobs) ───────────────────────────────────────────────────
register_event(
    "accounts", "guarantee_expiring", "Bank guarantee expiring",
    "an active guarantee / LC / EMD's expiry or claim period ends in 30, 15, 7 or 1 day(s), or has passed while still open",
    ("guarantees", "lifecycle", "edit"), default_channels=("bell", "teams"), kind="reminder",
)
register_event(
    "accounts", "promise_broken", "Customer promise to pay broken",
    "a customer's promise to pay passed its date without the promised amount coming in", ("collections", "view"),
    default_channels=("bell",), kind="reminder",
)
