"""R&D notifiable events (see core/notification_events.py). Fired from
app/modules/rnd (requirement work, technical offers, department replies,
project tasks, prototypes) through app/modules/rnd/services/events.py.
Requirement events also check the per-requirement access
(services/requirement_access.access_for(...)["view"]), so a member hears only
about requirements they can open."""
from app.core.notification_events import register_event

# ── Waiting for someone ──────────────────────────────────────────────────────
register_event(
    "rnd", "tor_received", "New Technical Offer Request from CRM",
    "CRM sends a requirement (TOR) to R&D, or re-sends it", ("requirements", "view"),
    default_channels=("bell", "teams"), kind="assignment",
)
register_event(
    "rnd", "task_approval_requested", "Requirement task — approval requested",
    "the assignee of a requirement task asks for an approval (drawing, material, deviation …)", ("requirements", "tasks", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "rnd", "task_assigned", "Requirement task assigned",
    "someone gives a task or sub-task on a requirement (to R&D or a shared department)", ("requirements", "tasks", "view"),
    kind="assignment",
)
register_event(
    "rnd", "project_task_assigned", "Project task assigned",
    "a project lead gives a task (or an assignee a sub-task) on a Prototype / Research project", ("projects", "tasks", "view"),
    kind="assignment",
)

# ── Outcomes / state changes ─────────────────────────────────────────────────
register_event(
    "rnd", "task_completed", "Requirement task completed",
    "the assignee completes a requirement task", ("requirements", "tasks", "view"),
)
register_event(
    "rnd", "department_replied", "Department feasibility reply received",
    "Design / Electrical / Hydraulic & Pneumatic replies to a requirement R&D shared with it", ("requirements", "departments", "view"),
)
register_event(
    "rnd", "technical_offer_released", "Technical Offer sent to the BD team",
    "the R&D head sends (releases) a Technical Offer to the BD team", ("requirements", "technical_offers", "view"),
)
register_event(
    "rnd", "prototype_released", "Prototype released to Production",
    "a prototype's BOM is frozen and handed to Production as a draft BOM", ("prototypes", "release_production", "view"),
)
