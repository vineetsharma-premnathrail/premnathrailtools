"""Production notifiable events (see core/notification_events.py).

Fired from app/modules/production (BOM activation and work-order release
routes + their approval-engine callbacks, work-order completion, RRV build
tests / rework / completion — see production/notify.py). Each event checks
the record's data scope, so a member hears only about records they can open.
Direct notices (approvers from the approval engine, supervisor, creator,
build manager, rework assignee) are kept and skipped here."""
from app.core.notification_events import register_event

# ── Waiting for a decision ───────────────────────────────────────────────────
register_event(
    "production", "bom_activation_submitted", "BOM sent for activation",
    "a draft BOM is submitted for activation and waits for a BOM approver", ("bom", "lifecycle", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "production", "wo_release_submitted", "Work order sent for release",
    "a draft work order is submitted for release to the shop floor", ("work_orders", "release", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)

# ── State changes ────────────────────────────────────────────────────────────
register_event(
    "production", "bom_activated", "BOM activated",
    "a BOM version becomes the product's active (or scheduled) version", ("bom", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "production", "wo_released", "Work order released",
    "a work order is released to the shop floor (its material is reserved)", ("work_orders", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "production", "wo_material_short", "Material short for a released work order",
    "a work order is released but Store couldn't reserve all of its material", ("work_orders", "materials", "create"),
    default_channels=("bell",), kind="info",
)
register_event(
    "production", "wo_completed", "Work order completed",
    "a work order is completed (finished goods received, operations done)", ("work_orders", "view"),
    default_channels=("bell",), kind="info",
)

# ── RRV builds ───────────────────────────────────────────────────────────────
register_event(
    "production", "rrv_test_failed", "RRV test failed",
    "a test recorded on an RRV build fails", ("rrv_builds", "tests", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "production", "rework_raised", "Rework raised on an RRV build",
    "a rework order is raised on an RRV build (failed test / inspection, or manually)", ("rrv_builds", "rework", "edit"),
    default_channels=("bell",), kind="assignment",
)
register_event(
    "production", "rrv_ready_for_handover", "RRV ready for handover",
    "an RRV build completes (registered in the machine registry) and can be handed over", ("rrv_builds", "handover", "edit"),
    default_channels=("bell",), kind="info",
)
