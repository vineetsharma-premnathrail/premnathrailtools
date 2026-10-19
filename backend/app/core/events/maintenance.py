"""Maintenance notifiable events (see core/notification_events.py).

Fired from app/modules/maintenance (request / work-order / permit / PR
routes, the PM work-order generator and reading-limit check in service.py /
counters.py, the below-minimum spare alert) and from the daily jobs
app/tasks/maintenance_pm_scheduler.py and maintenance_amc_reminders.py
(bell / Teams only — no email from a job). Every event checks the
Maintenance data scope (maintenance/role_events.py can_open). The plant's
maintenance team, assignees and requesters keep their direct notices; a role
event skips whoever was already told."""
from app.core.notification_events import register_event

# ── Requests (breakdowns) ────────────────────────────────────────────────────
register_event(
    "maintenance", "request_raised", "Maintenance request raised",
    "someone reports a fault / asks for maintenance on an asset", ("requests", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "maintenance", "critical_breakdown", "Breakdown on a critical asset",
    "a request reports a machine down on a criticality-A asset", ("requests", "view"),
    default_channels=("bell", "teams"), kind="info",
)
register_event(
    "maintenance", "request_acknowledged", "Maintenance request acknowledged",
    "Maintenance acknowledges a request (the requester is told directly)", ("requests", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "maintenance", "request_rejected", "Maintenance request rejected / duplicate",
    "Maintenance rejects a request or marks it a duplicate (the requester is told directly)", ("requests", "view"),
    default_channels=("bell",), kind="info",
)

# ── Work orders ──────────────────────────────────────────────────────────────
register_event(
    "maintenance", "wo_assigned", "Work order assigned to a technician",
    "a work order is assigned / re-assigned (incl. PM jobs) — the technician is told directly", ("work_orders", "view"),
    default_channels=("bell",), kind="assignment",
)
register_event(
    "maintenance", "wo_completed", "Work order completed — waiting for verification",
    "the technician marks a job completed; it needs verifying and closing", ("work_orders", "close_out", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "maintenance", "permit_issued", "Work permit waiting for acceptance",
    "a permit to work (PTW / LOTO) is issued and must be accepted at site", ("work_orders", "permits", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "maintenance", "wo_pr_raised", "Purchase requisition raised from a work order",
    "parts or outside service for a job are requisitioned to Purchase", ("work_orders", "purchase", "view"),
    default_channels=("bell",), kind="info",
)

# ── Assets / spares ──────────────────────────────────────────────────────────
register_event(
    "maintenance", "reading_limit_breach", "Meter / condition reading out of limits",
    "a reading is outside its measuring point's limits and a request is raised", ("assets", "readings", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "maintenance", "spare_below_min", "Critical spare below minimum",
    "a maintenance spare's total stock falls below its minimum / reorder level", ("spares", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)

# ── Reminders (daily jobs) ───────────────────────────────────────────────────
register_event(
    "maintenance", "pm_overdue", "Preventive maintenance overdue",
    "a PM work order is past its due date and not done (daily PM job)", ("schedule", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)
register_event(
    "maintenance", "amc_expiring", "Asset AMC / warranty expiring",
    "an asset's AMC or warranty is about to expire / just expired (daily job)", ("assets", "view"),
    default_channels=("bell", "teams"), kind="reminder",
)
