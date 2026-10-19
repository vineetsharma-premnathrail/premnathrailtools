"""Project Management notifiable events (see core/notification_events.py).

Fired from app/modules/projects/routes/project_tasks.py (milestones: given,
achieved, reopened, cancelled), routes/project.py (project lifecycle:
on hold, resumed, cancelled, closed) and the daily PM job
(app/tasks/pm_reminders.py — overdue milestones, bell / Teams only, no
email from a job). Every event checks the project's data scope
(projects/events.py) so a member hears only about projects they can open.
The people on the work (owner, whoever gave it, the project manager,
assignees) keep their direct notices and are skipped here."""
from app.core.notification_events import register_event

# ── Milestones ───────────────────────────────────────────────────────────────
register_event(
    "projects", "milestone_assigned", "Milestone given to someone",
    "a project milestone is given to a responsible person (new, or handed to someone else)",
    ("overview", "milestones", "view"), default_channels=("bell",), kind="assignment",
)
register_event(
    "projects", "milestone_achieved", "Milestone achieved",
    "a project milestone is marked achieved", ("overview", "milestone_status", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "projects", "milestone_reopened", "Milestone reopened",
    "an achieved milestone is reopened (with the reason)", ("overview", "milestone_status", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "projects", "milestone_cancelled", "Milestone cancelled",
    "an open milestone is cancelled (with the reason)", ("overview", "milestone_status", "view"),
    default_channels=("bell",), kind="info",
)

# ── Project lifecycle ────────────────────────────────────────────────────────
register_event(
    "projects", "project_on_hold", "Project put on hold",
    "a running project is put on hold (its open work is frozen)", ("all_projects", "view"),
    default_channels=("bell", "teams"), kind="info",
)
register_event(
    "projects", "project_resumed", "Project resumed",
    "a project on hold is resumed", ("all_projects", "view"),
    default_channels=("bell",), kind="info",
)
register_event(
    "projects", "project_cancelled", "Project cancelled",
    "a project is cancelled (its open milestones and tasks stop)", ("all_projects", "view"),
    default_channels=("bell", "teams"), kind="info",
)
register_event(
    "projects", "project_closed", "Project closed",
    "a project is closed from its closure panel", ("all_projects", "view"),
    default_channels=("bell",), kind="info",
)

# ── Reminders (daily PM job) ─────────────────────────────────────────────────
register_event(
    "projects", "milestone_overdue", "Milestone overdue",
    "a project milestone passed its expected date and is not achieved (repeats every few days)",
    ("overview", "milestones", "view"), default_channels=("bell", "teams"), kind="reminder",
)
