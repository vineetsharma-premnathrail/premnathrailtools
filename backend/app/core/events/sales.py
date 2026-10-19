"""Sales notifiable events (see core/notification_events.py). Fired from
app/modules/sales (approval engine hooks, order / delivery / proforma routes)
and from the daily Sales scheduler (app/tasks/sales_scheduler.py — bell /
Teams only, no email from a job). Every event checks the Sales data scope
(sales/access.ensure_order) so a member hears only about orders they can open."""
from app.core.notification_events import register_event

# ── Waiting for a decision ───────────────────────────────────────────────────
register_event(
    "sales", "order_submitted", "Sales order waiting for approval",
    "a sales order is submitted for approval", ("orders", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "sales", "amendment_submitted", "Sales order amendment waiting for approval",
    "an amendment of a confirmed order is submitted for approval", ("orders", "amendments", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "sales", "extension_requested", "Delivery-period extension requested",
    "a DP extension is requested for vehicles of an order", ("delivery", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)

# ── Reminders (daily Sales scheduler) ───────────────────────────────────────
register_event(
    "sales", "delivery_at_risk", "Delivery at risk",
    "the daily scheduler finds vehicles that may miss their contractual delivery date", ("delivery", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)
register_event(
    "sales", "delivery_overdue", "Delivery overdue (LD running)",
    "a vehicle passes its contractual delivery date undelivered (checked daily)", ("delivery", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)

# ── Outcomes / state changes ─────────────────────────────────────────────────
register_event(
    "sales", "order_confirmed", "Sales order confirmed",
    "a sales order completes its approvals and is confirmed (SO number issued)", ("orders", "view"),
)
register_event(
    "sales", "order_rejected", "Sales order rejected / returned",
    "an approver rejects a sales order or returns it for changes", ("orders", "view"),
)
register_event(
    "sales", "amendment_decided", "Amendment approved / rejected",
    "an amendment is approved (applied to the order), rejected or returned", ("orders", "amendments", "view"),
)
register_event(
    "sales", "delivery_confirmed", "Delivery / commissioning confirmed",
    "a vehicle of an order is marked delivered or commissioned", ("delivery", "view"),
)
register_event(
    "sales", "milestone_due", "Billing milestone due / invoice requested",
    "a manual billing milestone is marked due, or Sales asks Finance for a milestone's invoice", ("orders", "billing_plan", "view"),
)
register_event(
    "sales", "proforma_raised", "Proforma invoice raised",
    "a proforma invoice (advance) is raised on an order", ("orders", "proforma", "view"),
)
