"""Design notifiable events (see core/notification_events.py).

Fired from app/modules/design (revision / BOM / change / submission /
request routes, the approval-engine callbacks in design/approvals.py) and
from the daily job app/tasks/design_reminders.py (bell / Teams only — no
email from a job) through design/events.py notify_design_event. That
helper checks the record's data scope, and for records not yet released the
Design team rule, so a member hears only about what they can open. Direct
notices (author, named checker / approver, board members, requester, lead
designer, assignee, named acknowledgers, engine approvers) are kept and
skipped here."""
from app.core.notification_events import register_event

# ── Waiting for a check / decision ───────────────────────────────────────────
register_event(
    "design", "drawing_submitted", "Drawing revision sent for check",
    "a drawing / document revision is submitted for check and release", ("documents", "check_release", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "design", "bom_submitted", "BOM revision sent for check",
    "a BOM revision is submitted for check and release", ("boms", "check_release", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "design", "ecr_raised", "Change request (ECR) raised",
    "someone raises an engineering change request — its impact needs checking", ("change_notices", "ecr_impact", "edit"),
    default_channels=("bell",), kind="assignment",
)
register_event(
    "design", "ecr_ready_for_decision", "ECR ready for decision",
    "every change-board member has voted on an ECR", ("change_notices", "ecr_decision", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "design", "request_raised", "New design request",
    "a design request is brought to Design and waits to be accepted", ("project_work", "request_progress", "approve"),
    default_channels=("bell",), kind="approval",
)

# ── Assignments / follow-ups ─────────────────────────────────────────────────
register_event(
    "design", "ecn_acknowledgement_needed", "Released ECN needs acknowledgement",
    "an ECN is released and departments must acknowledge they acted on it", ("change_notices", "ecn_acknowledge", "submit"),
    default_channels=("bell", "teams"), kind="assignment",
)
register_event(
    "design", "customer_approval_needed", "Drawing ready for customer approval",
    "a drawing revision is approved internally and must go to the customer in a submission",
    ("reviews", "customer_submissions", "create"), default_channels=("bell",), kind="assignment",
)
register_event(
    "design", "comment_action_added", "Customer comment action added",
    "a customer comment on a submission is logged as an action for a designer", ("reviews", "comment_actions", "view"),
    default_channels=("bell",), kind="assignment",
)

# ── Outcomes / state changes ─────────────────────────────────────────────────
register_event(
    "design", "drawing_released", "Drawing revision released",
    "a drawing / document revision is released (it supersedes the previous one)", ("documents", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "design", "drawing_returned", "Drawing revision returned",
    "a checker or approver returns a drawing revision to its author", ("documents", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "design", "bom_released", "BOM revision released",
    "a BOM revision is released — the one Purchase buys, Store issues and Production builds to", ("boms", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "design", "bom_returned", "BOM revision returned",
    "a checker or approver returns a BOM revision to its author", ("boms", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "design", "ecr_decided", "ECR decided",
    "the Design head approves, rejects or defers an ECR", ("change_notices", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "design", "ecn_released", "Engineering change released",
    "an ECN is released (implemented) with its new drawing / BOM revisions", ("change_notices", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "design", "customer_response_recorded", "Customer response recorded",
    "the customer's response to a drawing submission is recorded", ("reviews", "customer_submissions", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "design", "request_accepted", "Design request accepted",
    "the Design head accepts a design request with its lead designer", ("project_work", "view"),
    default_channels=("bell",), kind="info",
)

# ── Reminders (daily Design job) ─────────────────────────────────────────────
register_event(
    "design", "customer_response_overdue", "Customer response overdue",
    "a sent customer submission passed its response due date (repeats weekly)", ("reviews", "customer_submissions", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)
register_event(
    "design", "request_overdue", "Design request overdue",
    "an active design request passed its due date while waiting on Design (daily)", ("project_work", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)
