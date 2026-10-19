"""Finance part B role events (core/events/accounts_b.py): one helper the
routes, engine callbacks and jobs call. Never raises."""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def fire(db: Session, event: str, *, title: str, message: str, entity_type: str | None, entity_id: int | None,
         record=None, actor=None, skip: set[int] | None = None, background_tasks=None,
         details: list[tuple[str, str]] | None = None) -> set[int]:
    """Send a Finance (part B) role event. When `record` is data-scoped, a
    member must be able to open that very record."""
    try:
        from app.core.data_scope import in_scope
        from app.core.notification_events import notify_event

        can_open = None
        if record is not None:
            def can_open(u):  # noqa: E306
                try:
                    return in_scope(db, u, record)
                except Exception:
                    return True  # model not data-scoped
        return notify_event(db, background_tasks, "accounts", event, title=title[:200], message=message,
                            entity_type=entity_type, entity_id=entity_id, actor=actor, can_open=can_open,
                            details=details, skip_user_ids={u for u in (skip or set()) if u})
    except Exception:
        logger.exception("Finance role event '%s' failed", event)
        return set()


def step_approvers(req) -> set[int]:
    """Everyone the approval engine already told directly."""
    return {s.approver_id for s in (getattr(req, "steps", None) or []) if getattr(s, "approver_id", None)}
