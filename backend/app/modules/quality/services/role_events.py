"""Role-based Quality notifications (core/events/quality.py): notify_event
limited to users whose data scope covers the record. Never raises; bell /
Teams rows join the caller's commit. `once_today` lets the daily jobs skip
users who already got the same reminder for the same record today."""
from datetime import date

from fastapi import BackgroundTasks
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.data_scope import in_scope
from app.core.notification_events import notify_event
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User


def pending_approver_ids(req) -> set[int]:
    """Approvers the approval engine has just notified directly."""
    return {s.approver_id for s in getattr(req, "steps", None) or [] if s.status == "pending" and s.approver_id}


def _already_today(db: Session, event: str, entity_type: str, entity_id: int) -> set[int]:
    return {uid for (uid,) in db.query(Notification.user_id).filter(
        Notification.notification_type == f"quality_ev_{event}"[:50], Notification.entity_type == entity_type,
        Notification.entity_id == entity_id, func.date(Notification.created_at) == date.today(),
    ).all()}


def fire(db: Session, event: str, *, record, title: str, message: str, entity_type: str, actor: User | None = None,
         skip: set | None = None, background_tasks: BackgroundTasks | None = None, once_today: bool = False) -> set[int]:
    def can_open(user: User) -> bool:
        try:
            return in_scope(db, user, record)
        except Exception:
            return False

    skip_ids = {i for i in (skip or set()) if i}
    if once_today:
        try:
            skip_ids |= _already_today(db, event, entity_type, record.id)
        except Exception:
            pass
    return notify_event(
        db, background_tasks, "quality", event, title=title, message=message,
        entity_type=entity_type, entity_id=record.id, actor=actor, can_open=can_open, skip_user_ids=skip_ids,
    )
