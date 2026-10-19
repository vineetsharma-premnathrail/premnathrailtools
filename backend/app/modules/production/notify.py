"""Role-based Production notifications (core/events/production.py): a thin
wrapper over notify_event that limits recipients to users whose data scope
covers the record. Never raises; bell / Teams rows join the caller's commit."""
from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.data_scope import in_scope
from app.core.notification_events import notify_event
from app.modules.main.models.user import User


def pending_approver_ids(req) -> set[int]:
    """Approvers the approval engine has just notified directly."""
    return {s.approver_id for s in getattr(req, "steps", None) or [] if s.status == "pending" and s.approver_id}


def fire(db: Session, event: str, *, record, title: str, message: str, entity_type: str, actor: User | None = None,
         skip: set | None = None, background_tasks: BackgroundTasks | None = None,
         details: list[tuple[str, str]] | None = None) -> set[int]:
    def can_open(user: User) -> bool:
        try:
            return in_scope(db, user, record)
        except Exception:
            return False

    return notify_event(
        db, background_tasks, "production", event, title=title, message=message,
        entity_type=entity_type, entity_id=record.id, actor=actor, can_open=can_open, details=details,
        skip_user_ids={i for i in (skip or set()) if i},
    )
