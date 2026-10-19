"""Service (ERP) notification rules, driven by Service → Settings
(app/modules/erp/settings.py). The rule engine itself is shared:
app/core/notify_rules.py. Approvals moved to the central approval engine —
see app/modules/erp/access.py."""
from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.notify_rules import fire_rule
from app.modules.erp.settings import NOTIFY_EVENTS
from app.modules.main.models.user import User


def fire_event(
    db: Session,
    background_tasks: BackgroundTasks | None,
    event: str,
    title: str,
    message: str,
    entity_type: str,
    entity_id: int,
    actor: User,
    details: list[tuple[str, str]] | None = None,
) -> None:
    """Apply the admin's Service rule for `event` (see app/core/notify_rules.py)."""
    if event not in NOTIFY_EVENTS:
        raise KeyError(f"Unknown Service notification event '{event}'.")
    fire_rule(db, background_tasks, "erp", event, title, message, entity_type, entity_id, actor, details)


# ── Role-based events (core/events/erp.py) ──────────────────────────────────

def can_open(db: Session, record):
    """can_open callback for notify_event: the member must have `record`
    inside their Service data scope (machines / service requests)."""
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
    actor: User | None,
    record=None,
    details: list[tuple[str, str]] | None = None,
    skip_user_ids: set[int] | None = None,
) -> set[int]:
    """notify_event for an erp event, scoped to `record`. Returns who it reached."""
    from app.core.notification_events import notify_event
    return notify_event(db, background_tasks, "erp", event, title=title, message=message,
                        entity_type=entity_type, entity_id=entity_id, actor=actor,
                        can_open=can_open(db, record) if record is not None else None,
                        details=details, skip_user_ids=skip_user_ids)


def approver_ids(req) -> set[int]:
    """Who the approval engine already asked directly (so a role event skips them)."""
    try:
        return {s.approver_id for s in (req.steps or []) if s.approver_id} if req is not None else set()
    except Exception:  # noqa: BLE001
        return set()


def broadcast_except(db: Session, skip: set[int], *, title: str, message: str, notification_type: str,
                     entity_type: str | None = None, entity_id: int | None = None, app_name: str = "erp") -> None:
    """The old "every Service user" bell, minus whoever a role event already
    reached (and the actor) — same rules as utils.notifications.broadcast_notification."""
    import logging
    from app.modules.main.models.notification import Notification
    from app.utils.notifications import _is_suppressed
    if _is_suppressed(notification_type):
        return
    try:
        for u in db.query(User).filter(User.is_active == True).all():  # noqa: E712
            if u.id in skip or not u.notifications_enabled or app_name not in u.get_apps():
                continue
            db.add(Notification(user_id=u.id, title=title, message=message, notification_type=notification_type,
                                entity_type=entity_type, entity_id=entity_id))
    except Exception:
        logging.getLogger(__name__).exception("Failed to broadcast notification '%s'", title)
