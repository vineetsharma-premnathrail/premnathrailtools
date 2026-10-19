"""Electrical notifiable events (see core/notification_events.py).

Fired from app/modules/electrical (jobs / bom / drawings / issues / testing
routes and the approval-engine callbacks in electrical/access.py) through
access.notify_job_event, which checks the job's data scope so a member hears
only about jobs they can open. Direct notices (lead engineer, preparer,
assignee, engine approvers) are kept and skipped here."""
from app.core.notification_events import register_event

# ── Waiting for a decision ───────────────────────────────────────────────────
register_event(
    "electrical", "bom_selection_submitted", "BOM component selection sent for approval",
    "a BOM line's make + part number is submitted for approval", ("jobs", "bom", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "electrical", "drawing_submitted", "Drawing revision waiting for approval",
    "a drawing revision of an RRV electrical job is submitted for approval", ("drawings", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)

# ── Assignments ──────────────────────────────────────────────────────────────
register_event(
    "electrical", "job_assigned", "Electrical job assigned",
    "a lead engineer is set (or changed) on an RRV electrical job", ("jobs", "view"),
    default_channels=("bell",), kind="assignment",
)

# ── Outcomes / state changes ─────────────────────────────────────────────────
register_event(
    "electrical", "bom_selection_approved", "BOM component selection approved",
    "a BOM line's component selection is approved", ("jobs", "bom", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "electrical", "drawing_approved", "Drawing revision approved",
    "a drawing revision is approved (it supersedes the previous one)", ("jobs", "drawings", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "electrical", "drawing_rejected", "Drawing revision rejected",
    "an approver rejects a drawing revision", ("jobs", "drawings", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "electrical", "qc_requested", "Final QC inspection requested",
    "a job raises its final electrical inspection in Quality", ("jobs", "handover", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "electrical", "job_on_hold", "Electrical job put on hold",
    "an RRV electrical job is put on hold", ("jobs", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "electrical", "job_cancelled", "Electrical job cancelled",
    "an RRV electrical job is cancelled", ("jobs", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "electrical", "job_handed_over", "RRV electrical handed over",
    "the RRV Electrical Handover stage is completed", ("jobs", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "electrical", "job_closed", "Electrical job closed",
    "a handed-over job is closed and its records become final", ("jobs", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "electrical", "issue_logged", "Electrical issue logged",
    "a troubleshooting issue is logged on a job", ("troubleshooting", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "electrical", "test_failed", "Electrical test failed",
    "a factory / commissioning test is recorded as failed", ("testing", "view"),
    default_channels=("bell",), kind="info",
)
