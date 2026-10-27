"""Procurement notifiable events (see core/notification_events.py). Fired from
app/modules/p2p (approvals.py for every submission / engine decision, the
requisition / RFQ / PO routes, and the daily PO-overdue job in
app/tasks/po_overdue_reminders.py). GRN / return-to-vendor events belong to
Store (core/events/store.py).

The PR / PO approvers themselves are fixed in Procurement › Settings and
routed by the approval engine, which notifies them directly — these role
events are for the people who follow the work (Purchase head, buyers,
controllers) and skip anyone already notified directly."""
from app.core.notification_events import register_event

# ── Waiting for a decision ───────────────────────────────────────────────────
register_event(
    "p2p", "pr_submitted", "Purchase requisition waiting for approval",
    "a purchase requisition is submitted (or resubmitted) and goes to its approvers", ("purchase_requisitions", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "p2p", "rfq_evaluation_waiting", "RFQ quotations waiting for evaluation",
    "an RFQ moves to technical or commercial evaluation of its vendor quotations", ("rfq", "evaluation", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "p2p", "po_submitted", "Purchase order waiting for approval",
    "a purchase order is sent for approval", ("purchase_orders", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "p2p", "po_amendment_submitted", "PO amendment waiting for approval",
    "an amendment of a released purchase order is sent for approval", ("purchase_orders", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "p2p", "service_entry_waiting", "Service entry waiting for acceptance",
    "a service entry is recorded against a PO's service lines and waits to be accepted", ("purchase_orders", "service_entries", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)

# ── Assignments ──────────────────────────────────────────────────────────────
register_event(
    "p2p", "pr_to_procurement", "Requisition lines sent to procurement",
    "requisition lines need buying (approved and not in stock, or sent to procurement by the buyer)", ("purchase_requisitions", "edit"),
    kind="assignment",
)
register_event(
    "p2p", "buyer_assigned", "Buyer assigned to a requisition",
    "a buyer is assigned to (or changed on) an approved requisition", ("purchase_requisitions", "buyer", "view"),
    kind="assignment",
)
register_event(
    "p2p", "pre_po_receipt_recorded", "Material received before its PO — PO to be made",
    "Store records goods that arrived before their purchase order (Store › Inward › Before PO); Procurement makes the PO", ("purchase_orders", "create"),
    kind="assignment",
)

# ── Reminders ────────────────────────────────────────────────────────────────
register_event(
    "p2p", "po_delivery_overdue", "PO delivery overdue",
    "a released PO passes its expected delivery date with goods still to come (daily job; sent once per PO)", ("purchase_orders", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)

# ── Outcomes / state changes ─────────────────────────────────────────────────
register_event(
    "p2p", "pr_decided", "Purchase requisition approved / rejected / returned",
    "a purchase requisition gets its final approval, is rejected, or is returned for changes", ("purchase_requisitions", "view"),
)
register_event(
    "p2p", "vendor_quote_received", "Vendor quotation recorded",
    "a vendor's quotation is recorded on an RFQ", ("rfq", "vendor_quotes", "view"),
)
register_event(
    "p2p", "po_decided", "Purchase order approved / rejected / returned",
    "a purchase order gets its final approval (released to the vendor), is rejected or is returned for changes", ("purchase_orders", "view"),
)
