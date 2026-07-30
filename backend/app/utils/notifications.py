"""In-app notification side effects for ERP events (sync SQLAlchemy Session)."""
import logging
from sqlalchemy.orm import Session
from app.modules.main.models.user import User
from app.modules.main.models.notification import Notification

logger = logging.getLogger(__name__)


def broadcast_notification(
    db: Session,
    title: str,
    message: str,
    notification_type: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    exclude_user_id: int | None = None,
    app_name: str = "erp",
) -> None:
    """Notify every user with access to `app_name` (except the actor)."""
    try:
        for u in db.query(User).filter(User.is_active == True).all():  # noqa: E712
            if app_name not in u.get_apps():
                continue
            if exclude_user_id and u.id == exclude_user_id:
                continue
            db.add(Notification(
                user_id=u.id, title=title, message=message, notification_type=notification_type,
                entity_type=entity_type, entity_id=entity_id,
            ))
    except Exception:
        logger.exception("Failed to broadcast notification '%s'", title)


def notify_user(
    db: Session,
    user_id: int,
    title: str,
    message: str,
    notification_type: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
) -> None:
    try:
        db.add(Notification(
            user_id=user_id, title=title, message=message, notification_type=notification_type,
            entity_type=entity_type, entity_id=entity_id,
        ))
    except Exception:
        logger.exception("Failed to notify user %s: '%s'", user_id, title)
