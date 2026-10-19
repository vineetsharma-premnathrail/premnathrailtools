"""Role-based Maintenance notifications (core/events/maintenance.py) —
a thin wrapper over core.notification_events.notify_event that adds the
Maintenance data-scope check for the record the notice is about."""
from __future__ import annotations

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.modules.main.models.user import User


def can_open(db: Session, record):
    from app.core.data_scope import in_scope

    def _check(user: User) -> bool:
        return record is None or in_scope(db, user, record)
    return _check


def role_event(
    db: Session,
    background_tasks: BackgroundTasks | None,
    event: str,
    *,
    title: str,
    message: str,
    entity_type: str,
    entity_id: int,
    actor: User | None = None,
    record=None,
    skip_user_ids=None,
) -> set[int]:
    """Send maintenance.<event> to subscribed roles; returns who it reached."""
    from app.core.notification_events import notify_event
    skip = {u for u in (skip_user_ids or ()) if u}
    return notify_event(db, background_tasks, "maintenance", event, title=title, message=message,
                        entity_type=entity_type, entity_id=entity_id, actor=actor,
                        can_open=can_open(db, record) if record is not None else None, skip_user_ids=skip)
