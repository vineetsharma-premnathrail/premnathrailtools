"""Role-based notifications for Project Management (events declared in
core/events/projects.py). One helper so every trigger applies the same
record check: a member hears only about projects inside their data scope."""
from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.notification_events import notify_event
from app.modules.main.models.user import User
from app.modules.projects.models.project import PmProject


def can_open_project(db: Session, project: PmProject):
    def _check(u: User) -> bool:
        try:
            ensure_in_scope(db, u, project)
            return True
        except Exception:
            return False
    return _check


def pm_event(db: Session, background_tasks: BackgroundTasks | None, event: str, project: PmProject, *,
             title: str, message: str, entity_type: str, entity_id: int, actor: User | None = None,
             skip=()) -> set[int]:
    """notify_event for one project; `skip` = people who already got a direct notice."""
    return notify_event(
        db, background_tasks, "projects", event, title=title, message=message,
        entity_type=entity_type, entity_id=entity_id, actor=actor,
        can_open=can_open_project(db, project), skip_user_ids={i for i in skip if i},
        details=[("Project", f"{project.project_code} {project.name}")],
    )
