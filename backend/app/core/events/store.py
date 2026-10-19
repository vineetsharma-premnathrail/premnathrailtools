"""Store notifiable events (see core/notification_events.py). Fired from
app/modules/store (routes, stock ledger, job-work reminder job) and from the
GRN routes in app/modules/p2p (GRNs are worked in Store › GRN & Inspection)."""
from app.core.notification_events import register_event

# ── Waiting for a decision ───────────────────────────────────────────────────
register_event(
    "store", "adjustment_submitted", "Stock adjustment waiting for approval",
    "a stock adjustment is raised and goes to its approver", ("adjustments", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "store", "count_submitted", "Physical count differences waiting for approval",
    "a physical / cycle count is submitted and its differences go for approval as one adjustment", ("adjustments", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "store", "return_submitted", "Material return waiting for approval",
    "a material return needs an approval before it posts to stock", ("returns", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "store", "transfer_submitted", "Stock transfer waiting for approval",
    "a store-to-store transfer is raised and goes to the sending store's approver", ("transfers", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "store", "grn_awaiting_inspection", "Goods received — waiting for inspection",
    "a GRN is saved with lines waiting for the inspection decision (goods sit in Quality stock)", ("grn", "inspection", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)

# ── Outcomes / state changes ─────────────────────────────────────────────────
register_event(
    "store", "adjustment_decided", "Stock adjustment approved / rejected",
    "a stock adjustment is approved (stock posted), rejected or returned", ("adjustments", "view"),
)
register_event(
    "store", "return_decided", "Material return approved / rejected",
    "a material return is approved (posted to stock), rejected or returned", ("returns", "view"),
)
register_event(
    "store", "grn_inspected", "GRN inspected (accepted / rejected)",
    "the inspection of a GRN is completed — accepted goes to Free stock, rejected to Blocked", ("grn", "view"),
)
register_event(
    "store", "transfer_dispatched", "Stock transfer dispatched to your store",
    "an approved transfer is dispatched — the receiving store must confirm receipt", ("transfers", "receive", "edit"),
    default_channels=("bell", "teams"), kind="assignment",
)
register_event(
    "store", "transfer_received", "Stock transfer received",
    "a dispatched transfer is received at the destination store", ("transfers", "view"),
)
register_event(
    "store", "stock_below_reorder", "Stock fell to / below the reorder level",
    "a stock movement takes an item's available stock at a store from above to at / below its reorder level", ("stock", "view"),
)
register_event(
    "store", "stock_blocked", "Material put into Blocked (quarantine) stock",
    "rejected / damaged material is posted to Blocked stock and waits to be scrapped, returned or released",
    ("adjustments", "quarantine_clear", "create"),
)

# ── Reminders (scheduled job) ────────────────────────────────────────────────
register_event(
    "store", "jobwork_due_back", "Job-work material due back (GST Rule 45)",
    "daily job: a job-work challan still holding material reaches a reminder step (300/330/360 days inputs, 1000/1080 days capital goods)",
    ("issues", "job_work", "view"), default_channels=("bell", "teams"), kind="reminder",
)
