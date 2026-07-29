from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.notification import Notification
from app.modules.main.routes.auth import get_current_user

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/unread-count")
async def get_unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    count = db.query(Notification).filter(Notification.user_id == user.id, Notification.is_read == False).count()  # noqa: E712
    return {"count": count}


@router.get("")
async def list_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notifications = db.query(Notification).filter(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(30).all()
    return [
        {
            "id": n.id,
            "title": n.title,
            "message": n.message,
            "notification_type": n.notification_type,
            "entity_type": n.entity_type,
            "entity_id": n.entity_id,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in notifications
    ]


@router.patch("/{notification_id}/read")
async def mark_as_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == user.id).first()
    if notification:
        notification.is_read = True
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
    return {"message": "Marked as read"}


@router.patch("/read-all")
async def mark_all_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.is_read == False).update(  # noqa: E712
        {"is_read": True, "read_at": datetime.now(timezone.utc)}
    )
    db.commit()
    return {"message": "All marked as read"}
