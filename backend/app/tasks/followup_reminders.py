"""Daily reminder notifications for CRM Activity follow-ups.

Runs once a day (wired up in app/main.py) and notifies the assigned user —
falling back to the activity's creator if `assigned_to` (free text) doesn't
match any known user by name — one day before `next_followup` and again on
the day itself. Only "Open" activities are considered; a Done/Cancelled one
doesn't need a nudge.
"""
import logging
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.organization import Organization
from app.modules.main.models.user import User
from app.modules.main.models.notification import Notification
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)

DUE_TODAY = "activity_followup_due_today"
DUE_TOMORROW = "activity_followup_due_tomorrow"


def _resolve_target_user_id(db, activity: Activity) -> int | None:
    if activity.assigned_to:
        match = db.query(User).filter(
            User.is_active == True,  # noqa: E712
            func.lower(User.name) == activity.assigned_to.strip().lower(),
        ).first()
        if match:
            return match.id
    return activity.created_by_id


def _already_sent_today(db, user_id: int, activity_id: int, notification_type: str) -> bool:
    return db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.entity_type == "activity",
        Notification.entity_id == activity_id,
        Notification.notification_type == notification_type,
        func.date(Notification.created_at) == date.today(),
    ).first() is not None


def _send_activity_followup_reminders(db: Session) -> None:
    """Pure logic over an already-open session — kept separate from session
    management so tests can call this directly against an isolated test DB."""
    today = date.today()
    tomorrow = today + timedelta(days=1)
    activities = db.query(Activity).filter(
        Activity.is_deleted == False,  # noqa: E712
        Activity.status == "Open",
        Activity.next_followup.in_([today, tomorrow]),
    ).all()

    for activity in activities:
        user_id = _resolve_target_user_id(db, activity)
        if not user_id:
            continue

        due_today = activity.next_followup == today
        notification_type = DUE_TODAY if due_today else DUE_TOMORROW
        if _already_sent_today(db, user_id, activity.id, notification_type):
            continue

        org_name = None
        if activity.org_id:
            org = db.query(Organization).filter(Organization.id == activity.org_id).first()
            org_name = org.name if org else None

        subject = activity.activity_type or "Activity"
        where = f" with {org_name}" if org_name else ""
        when = "today" if due_today else "tomorrow"
        notify_user(
            db,
            user_id=user_id,
            title=f"Follow-up due {when}",
            message=f"{subject}{where} is due for follow-up {when} ({activity.next_followup.isoformat()}).",
            notification_type=notification_type,
            entity_type="activity",
            entity_id=activity.id,
        )

    db.commit()


def send_activity_followup_reminders() -> None:
    """Scheduler entry point (see app/main.py) — opens its own DB session
    since it runs outside any request context."""
    db = SessionLocal()
    try:
        _send_activity_followup_reminders(db)
    except Exception:
        db.rollback()
        logger.exception("Failed to send activity follow-up reminders")
    finally:
        db.close()
