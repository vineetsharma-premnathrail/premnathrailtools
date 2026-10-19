"""Role-based HR notifications (core/events/hr.py): notify_event plus the HR
data-access check, so a subscribed role member hears only about records
they could open. Never raises (notify_event swallows its own errors)."""
from __future__ import annotations

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

from app.core.notification_events import notify_event
from app.modules.main.models.user import User


def approver_ids(req) -> set[int]:
    """Everyone the approval engine already pinged on `req` (step approvers
    and escalation targets) — skipped by the role event."""
    ids: set[int] = set()
    for s in getattr(req, "steps", None) or []:
        if s.approver_id:
            ids.add(s.approver_id)
        ids |= {i for i in (s.escalated_to_ids or []) if isinstance(i, int)}
    return ids


def employee_opener(db: Session, employee: User | None):
    """can_open: the member's HR data access covers `employee`."""
    if employee is None:
        return None
    from app.modules.hr.services.approvals import ensure_employee_in_scope

    def _can(u: User) -> bool:
        try:
            ensure_employee_in_scope(db, u, employee)
            return True
        except HTTPException:
            return False
    return _can


def record_opener(db: Session, record):
    """can_open: the record is inside the member's data scope."""
    from app.core.data_scope import in_scope

    return lambda u: in_scope(db, u, record)


def fire(db: Session, background_tasks: BackgroundTasks | None, event: str, *, title: str, message: str,
         entity_type: str, entity_id: int, actor: User | None = None, can_open=None,
         skip: set[int] | None = None, details: list[tuple[str, str]] | None = None) -> set[int]:
    return notify_event(db, background_tasks, "hr", event, title=title, message=message, entity_type=entity_type,
                        entity_id=entity_id, actor=actor, can_open=can_open, details=details,
                        skip_user_ids={i for i in (skip or set()) if i})
