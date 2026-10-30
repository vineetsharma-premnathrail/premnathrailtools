"""R&D notifiable events (see core/notification_events.py). Fired from
app/modules/rnd (requirement intake and work, technical offers, project tasks,
prototypes) through app/modules/rnd/services/events.py.
Requirement events also check the requirement access
(services/requirement_access.access_for(...)["view"]), so a member hears only
about requirements they can open. Teams carries only approvals and reminders:
a new / accepted / returned requirement is bell-only; "review pending" is the
one Teams reminder."""
from app.core.notification_events import register_event

# ── Waiting for someone ──────────────────────────────────────────────────────
register_event(
    "rnd", "tor_received", "New requirement received",
    "BD sends a requirement to R&D, or re-sends it (a new revision)", ("requirements", "view"),
    default_channels=("bell",), kind="assignment",
)
register_event(
    "rnd", "review_pending", "Requirement waiting for R&D review",
    "a requirement sent by BD is still not accepted or returned after 2 working days (repeats every 3 days)",
    ("requirements", "view"), default_channels=("bell", "teams"), kind="reminder",
)
register_event(
    "rnd", "task_approval_requested", "Requirement task — approval requested",
    "the assignee of a requirement task asks for an approval (drawing, material, deviation …)", ("requirements", "tasks", "approve"),
    default_channels=("bell", "teams"), kind="approval",
)
register_event(
    "rnd", "task_assigned", "Requirement task assigned",
    "someone gives a task or sub-task on a requirement", ("requirements", "tasks", "view"),
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
    "rnd", "technical_offer_released", "Technical Offer sent to the BD team",
    "the R&D head releases an uploaded Technical Offer to the BD team", ("requirements", "technical_offers", "view"),
)
register_event(
    "rnd", "prototype_released", "Prototype released to Production",
    "a prototype's BOM is frozen and handed to Production as a draft BOM", ("prototypes", "release_production", "view"),
)
