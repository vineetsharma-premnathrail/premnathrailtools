"""CRM notification helpers on top of core/notification_events.notify_event."""
import logging

from sqlalchemy.orm import Session

from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.utils.notifications import _is_suppressed

logger = logging.getLogger(__name__)


def broadcast_except(db: Session, skip: set[int], *, title: str, message: str, notification_type: str,
                     entity_type: str | None, entity_id: int | None, exclude_user_id: int | None, app_name: str = "crm") -> None:
    """utils.notifications.broadcast_notification (bell to every user of the
    app except the actor) that also leaves out `skip` — the people a role
    event already told, so nobody gets the same notice twice."""
    if _is_suppressed(notification_type):
        return
    try:
        for u in db.query(User).filter(User.is_active == True).all():  # noqa: E712
            if u.id in skip or u.id == exclude_user_id or app_name not in u.get_apps() or not u.notifications_enabled:
                continue
            db.add(Notification(user_id=u.id, title=title, message=message, notification_type=notification_type,
                                entity_type=entity_type, entity_id=entity_id))
    except Exception:
        logger.exception("Failed to broadcast notification '%s'", title)
