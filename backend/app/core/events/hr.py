"""HR & Administration notifiable events (see core/notification_events.py).

Fired from app/modules/hr (services/role_events.py wraps notify_event with
the HR data-access check). The direct notices that already exist — the
approval engine pinging the reporting manager, the requester hearing the
decision, the CAPA owner / checklist task owner / visit host hearing about
their own item — stay; those people are skipped here so nobody gets the same
notice twice."""
from app.core.notification_events import register_event

# ── waiting for a decision ───────────────────────────────────────────────
register_event(
    "hr", "leave_submitted", "Leave request waiting for approval",
    "an employee (or HR on their behalf) applies for leave", ("leave", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "hr", "regularization_submitted", "Attendance correction waiting for approval",
    "an employee asks to regularize a past day's attendance", ("approvals", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "hr", "overtime_submitted", "Overtime claim waiting for approval",
    "overtime is claimed by an employee or generated from punches", ("approvals", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "hr", "travel_submitted", "Travel request waiting for approval",
    "an employee raises a travel request", ("travel", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "hr", "claim_submitted", "Expense claim waiting for approval",
    "an employee submits (or resubmits) an expense claim", ("travel", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)

# ── assignments / work to do ─────────────────────────────────────────────
register_event(
    "hr", "claim_ready_for_payment", "Expense claim approved — ready to pay",
    "an expense claim is approved and waits for payment", ("travel", "claim_payment", "edit"),
    kind="assignment",
)
register_event(
    "hr", "capa_assigned", "Safety CAPA action assigned",
    "a corrective / preventive action is added to an incident or handed to a new owner", ("safety", "capa", "view"),
    kind="assignment",
)
register_event(
    "hr", "checklist_item_assigned", "Lifecycle checklist item assigned",
    "joining / exit / transfer checklist items go to their owners", ("lifecycle", "checklist", "edit"),
    kind="assignment",
)

# ── important state changes ──────────────────────────────────────────────
register_event(
    "hr", "safety_incident_reported", "Safety incident reported",
    "a safety incident (injury, near miss, dangerous occurrence …) is reported", ("safety", "view"),
    default_channels=("bell", "teams"), kind="info",
)
register_event(
    "hr", "claim_paid", "Expense claim paid",
    "an expense claim is marked paid (HR) or paid by a Finance payment voucher", ("travel", "view"),
    kind="info",
)
register_event(
    "hr", "period_locked", "Attendance period locked for payroll",
    "a month's attendance is locked for the ADP payroll cut-off", ("attendance", "periods", "view"),
    kind="info",
)
register_event(
    "hr", "period_unlocked", "Attendance period unlocked",
    "a Partner unlocks a locked attendance month (with a reason)", ("attendance", "periods", "view"),
    default_channels=("bell", "teams"), kind="info",
)
register_event(
    "hr", "visitor_checked_in", "Visitor checked in at the gate",
    "a visitor is checked in at the gate (pre-registered or walk-in)", ("visitors", "view"),
    kind="info",
)
