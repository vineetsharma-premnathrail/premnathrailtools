"""Quality notifiable events (see core/notification_events.py).

Fired from app/modules/quality/services (lots, ncr, capa, first_article,
complaints — see quality/services/role_events.py) and from the daily jobs
app/tasks/quality_reminders.py and gauge_calibration_reminders.py (bell /
Teams only, no email from a job). Every event checks the record's data scope.
Direct notices (assigned inspector, Quality engineers / heads, the approval
engine's approvers, action owner, gauge custodian) are kept and skipped here."""
from app.core.notification_events import register_event

# ── Waiting for someone ──────────────────────────────────────────────────────
register_event(
    "quality", "lot_waiting_results", "Inspection lot waiting for results",
    "a new inspection lot (GRN, job work, production gate / output, manual) is waiting to be inspected",
    ("inspection_lots", "results", "edit"), default_channels=("bell",), kind="assignment",
)
register_event(
    "quality", "lot_waiting_decision", "Inspection lot waiting for the usage decision",
    "an inspector submits a lot's results and it waits for the usage decision",
    ("inspection_lots", "usage_decision", "approve"), default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "quality", "ncr_disposition_waiting", "NCR disposition waiting for approval",
    "a disposition is proposed on an NCR and waits for its approvals", ("ncr", "disposition", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "quality", "fai_decision_waiting", "First article waiting for a decision",
    "a first-article lot gets its usage decision, so the first article can be approved or rejected",
    ("first_article", "decision", "approve"), default_channels=("bell",), kind="approval",
)
register_event(
    "quality", "capa_action_assigned", "CAPA action assigned",
    "a corrective / preventive action is added to a CAPA with an owner and due date", ("capa", "actions", "view"),
    default_channels=("bell",), kind="assignment",
)

# ── State changes ────────────────────────────────────────────────────────────
register_event(
    "quality", "ncr_raised", "NCR raised",
    "a non-conformance report is raised (from an inspection lot or manually)", ("ncr", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "quality", "ncr_closed", "NCR closed",
    "a Quality head closes an NCR with its cost of non-quality", ("ncr", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "quality", "complaint_received", "Customer complaint received",
    "a customer complaint is logged in Quality", ("complaints", "view"),
    default_channels=("bell", "teams"), kind="info",
)

# ── Reminders (daily jobs) ───────────────────────────────────────────────────
register_event(
    "quality", "capa_action_overdue", "CAPA action overdue",
    "a CAPA action passed its due date (daily Quality reminders)", ("capa", "actions", "view"),
    default_channels=("bell",), kind="reminder",
)
register_event(
    "quality", "gauge_calibration_due", "Gauge calibration due",
    "a gauge's calibration is due within the Quality setting's days, or overdue (daily gauge reminders)",
    ("masters", "calibration", "create"), default_channels=("bell",), kind="reminder",
)
