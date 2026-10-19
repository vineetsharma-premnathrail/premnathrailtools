"""Role-based R&D notifications (events declared in app/core/events/rnd.py).

Thin wrappers around notify_event that add the R&D record checks: a
requirement event reaches only R&D-side members who can open that requirement
(requirement_access.access_for(...)["view"]); a project event only members
whose data scope covers the project. Never raise — a notice must not break the
business action."""
from __future__ import annotations

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

from app.core.notification_events import notify_event
from app.modules.main.models.user import User
from app.modules.rnd.services import requirement_access as ra


def requirement_event(db: Session, event: str, source: str, record_id: int, *, title: str, message: str,
                      actor: User | None, skip_user_ids: set[int] | None = None,
                      background_tasks: BackgroundTasks | None = None) -> set[int]:
    def can_open(u: User) -> bool:
        return ra.is_rnd_side(u) and bool(ra.access_for(db, u, source, record_id)["view"])

    return notify_event(db, background_tasks, "rnd", event, title=title, message=message,
                        entity_type=f"rnd_req_{source}", entity_id=record_id, actor=actor,
                        can_open=can_open, skip_user_ids=skip_user_ids)


def tor_received(db: Session, *, source: str, record, offer_number: str, due_date, actor: User | None,
                 skip_user_ids: set[int] | None = None, background_tasks: BackgroundTasks | None = None) -> set[int]:
    """CRM sent / re-sent a requirement to R&D. Call from CRM's send flow
    (crm/services/requirement_movement.create_rnd_request), passing the R&D
    head(s) already told directly in skip_user_ids."""
    ref = offer_number or getattr(record, "universal_id", None) or f"{source} #{record.id}"
    by = (actor.name or actor.email) if actor else "CRM"
    return requirement_event(
        db, "tor_received", source, record.id,
        title=f"Technical Offer Request {ref} received",
        message=f"{by} sent {ref} to R&D — response due {due_date.strftime('%d %b %Y')}. Open R&D › Requirements to review it.",
        actor=actor, skip_user_ids=skip_user_ids, background_tasks=background_tasks,
    )


def project_event(db: Session, event: str, project, *, title: str, message: str, actor: User | None,
                  skip_user_ids: set[int] | None = None, background_tasks: BackgroundTasks | None = None,
                  entity_type: str = "rnd_project") -> set[int]:
    """An event about a data-scoped R&D record (project, prototype): reaches
    members whose R&D data scope covers `project` (the record itself)."""
    from app.modules.rnd.scope import ensure_in_scope

    def can_open(u: User) -> bool:
        try:
            ensure_in_scope(db, u, project)
            return True
        except HTTPException:
            return False

    return notify_event(db, background_tasks, "rnd", event, title=title, message=message,
                        entity_type=entity_type, entity_id=project.id, actor=actor,
                        can_open=can_open, skip_user_ids=skip_user_ids)
