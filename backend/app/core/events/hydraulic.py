"""Hydraulic & Pneumatic notifiable events (see core/notification_events.py).

Fired from app/modules/hydraulic (circuit / BOM / testing routes and the
approval-engine callbacks in hydraulic/access.py) through
access.notify_hyd_event, which checks the record's data scope so a member
hears only about records they can open. The engine's own notices to the
approvers / requester are kept and skipped here."""
from app.core.notification_events import register_event

# ── Waiting for a decision ───────────────────────────────────────────────────
register_event(
    "hydraulic", "circuit_submitted", "Circuit submitted for review",
    "a circuit diagram revision is sent for review", ("circuits", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "hydraulic", "bom_submitted", "BOM sent for release approval",
    "a draft hydraulic / pneumatic BOM is submitted for release", ("bom", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "hydraulic", "test_result_submitted", "Test result waiting for sign-off",
    "a tester submits a test / inspection result for sign-off", ("testing", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)

# ── Outcomes / state changes ─────────────────────────────────────────────────
register_event(
    "hydraulic", "circuit_approved", "Circuit approved",
    "a circuit revision is approved and becomes the revision in force", ("circuits", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "hydraulic", "circuit_returned", "Circuit returned for changes",
    "a reviewer returns (or rejects) a circuit revision to draft", ("circuits", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "hydraulic", "bom_released", "BOM released",
    "a BOM revision is released (the previous released revision becomes obsolete)", ("bom", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "hydraulic", "bom_revised", "New BOM revision raised",
    "a released BOM is copied into a new draft revision", ("bom", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "hydraulic", "test_failed", "Hydraulic / pneumatic test failed",
    "a test / inspection is signed off with result 'fail'", ("testing", "view"),
    default_channels=("bell", "teams"), kind="info",
)
