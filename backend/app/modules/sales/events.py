"""Role-based Sales notifications (events declared in app/core/events/sales.py).

`order_event` sends a Sales event about one order to the subscribed roles'
members whose Sales data scope lets them open it (access.ensure_order).
Messages carry no amounts — some members may lack Prices & margins. Never
raises — a notice must not break the business action."""
from __future__ import annotations

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.notification_events import notify_event
from app.modules.main.models.user import User
from app.modules.sales.models.order import SalesOrder


def order_event(db: Session, background_tasks: BackgroundTasks | None, event: str, so: SalesOrder, *,
                title: str, message: str, actor: User | None = None, skip_user_ids=None,
                entity_type: str = "sales_order", entity_id: int | None = None) -> set[int]:
    from app.modules.sales.access import ensure_order

    def can_open(u: User) -> bool:
        try:
            ensure_order(db, u, so)
            return True
        except Exception:
            return False

    return notify_event(db, background_tasks, "sales", event, title=title, message=message,
                        entity_type=entity_type, entity_id=entity_id if entity_id is not None else so.id,
                        actor=actor, can_open=can_open, skip_user_ids={u for u in (skip_user_ids or ()) if u})


def pending_approver_ids(req) -> set[int]:
    """Approvers the engine just asked (they already got its own notice)."""
    try:
        return {st.approver_id for st in (req.steps or [])
                if st.status == "pending" and st.sequence == req.current_sequence and st.approver_id}
    except Exception:
        return set()
