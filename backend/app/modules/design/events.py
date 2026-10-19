"""Role-based Design notifications (events declared in app/core/events/design.py).

notify_design_event sends an event to members of subscribed roles who may
open the record: the record's data scope (design/scope.py), plus — for a
record that isn't released yet — the Design team rule (viewers only see
released drawings / BOMs). Direct notices stay where they are; pass their
recipients in `skip` so nobody hears the same thing twice."""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.user import User

MODULE = "design"


def notify_design_event(db: Session, background_tasks, event: str, record, *, entity_type: str, title: str,
                        message: str, actor: User | None = None, skip=None, team_only: bool = False,
                        details: list[tuple[str, str]] | None = None) -> set[int]:
    from app.core.notification_events import notify_event
    from app.modules.design.access import is_team
    from app.modules.design.scope import ensure_in_scope

    def can_open(u: User) -> bool:
        if team_only and not is_team(db, u):
            return False
        try:
            ensure_in_scope(db, u, record)
            return True
        except HTTPException:
            return False

    return notify_event(
        db, background_tasks, MODULE, event, title=title, message=message,
        entity_type=entity_type, entity_id=record.id, actor=actor, can_open=can_open,
        details=details, skip_user_ids={i for i in (skip or ()) if i},
    )
