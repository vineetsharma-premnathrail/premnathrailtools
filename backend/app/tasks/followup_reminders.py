"""Daily reminder notifications for CRM Activity follow-ups.

Runs once a day (wired up in app/main.py) and notifies the assigned user —
falling back to the activity's creator if `assigned_to` (free text) doesn't
match any known user by name — one day before `next_followup`, again on the
day itself, and every day it remains open and past due. Only "Open"
activities are considered; a Done/Cancelled one doesn't need a nudge.
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
from app.core.notification_events import notify_event

logger = logging.getLogger(__name__)

DUE_TODAY = "activity_followup_due_today"
DUE_TOMORROW = "activity_followup_due_tomorrow"
OVERDUE = "activity_followup_overdue"


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
        Activity.next_followup <= tomorrow,
    ).all()

    for activity in activities:
        user_id = _resolve_target_user_id(db, activity)
        if not user_id:
            continue

        if activity.next_followup < today:
            notification_type = OVERDUE
        elif activity.next_followup == today:
            notification_type = DUE_TODAY
        else:
            notification_type = DUE_TOMORROW
        if _already_sent_today(db, user_id, activity.id, notification_type):
            continue

        org_name = None
        if activity.org_id:
            org = db.query(Organization).filter(Organization.id == activity.org_id).first()
            org_name = org.name if org else None

        subject = activity.activity_type or "Activity"
        where = f" with {org_name}" if org_name else ""
        if notification_type == OVERDUE:
            days_overdue = (today - activity.next_followup).days
            day_word = "day" if days_overdue == 1 else "days"
            notify_user(
                db,
                user_id=user_id,
                title="Follow-up overdue",
                message=f"{subject}{where} was due for follow-up on {activity.next_followup.isoformat()} — {days_overdue} {day_word} overdue.",
                notification_type=notification_type,
                entity_type="activity",
                entity_id=activity.id,
                teams=True,
            )
        else:
            when = "today" if notification_type == DUE_TODAY else "tomorrow"
            notify_user(
                db,
                user_id=user_id,
                title=f"Follow-up due {when}",
                message=f"{subject}{where} is due for follow-up {when} ({activity.next_followup.isoformat()}).",
                notification_type=notification_type,
                entity_type="activity",
                entity_id=activity.id,
                teams=True,
            )

    _send_role_reminders(db, today)
    db.commit()


TENDER_DUE_DAYS = (3, 1)


def _send_role_reminders(db: Session, today: date) -> None:
    """Role-based reminders (core/events/crm.py), bell / Teams only (no email
    from a job). Each fires on one specific day, so a daily run announces a
    record once per milestone."""
    from app.modules.crm.access import can_open_activity, can_open_record
    from app.modules.crm.models.tender import Tender
    from app.modules.crm.services import quotation_status

    # Follow-ups of inquiries / tenders that became overdue yesterday (the
    # assignee keeps getting the direct daily nudge above — skipped here).
    yesterday = today - timedelta(days=1)
    for a in db.query(Activity).filter(
        Activity.is_deleted == False, Activity.status == "Open", Activity.next_followup == yesterday,  # noqa: E712
        Activity.related_module.in_(("inquiry", "tender")),
    ).all():
        target = _resolve_target_user_id(db, a)
        notify_event(
            db, None, "crm", "followup_overdue",
            title=f"Follow-up overdue — {a.universal_id or a.activity_type or 'follow-up'}",
            message=f"{a.activity_type or 'Follow-up'} on {a.universal_id or a.related_module} "
                    f"(assigned to {a.assigned_to or 'nobody'}) was due on {a.next_followup.strftime('%d-%m-%Y')} and is still open.",
            entity_type="activity", entity_id=a.id, can_open=can_open_activity(db, a),
            skip_user_ids={target} if target else None,
        )

    # Live tenders whose submission date is 3 days / 1 day away.
    for days in TENDER_DUE_DAYS:
        due = today + timedelta(days=days)
        for t in db.query(Tender).filter(Tender.is_deleted == False, Tender.submission_date == due).all():  # noqa: E712
            if (t.status or "").startswith(("Closed", "Tender Cancelled", "Tender Submitted")):
                continue
            notify_event(
                db, None, "crm", "tender_submission_due",
                title=f"Tender {t.universal_id} due in {days} day{'s' if days != 1 else ''}",
                message=f"Tender {t.tender_name or t.tender_number or t.universal_id} must be submitted by {due.strftime('%d-%m-%Y')} "
                        f"(status: {t.status}). Finish the bid documents and submit on the portal.",
                entity_type="tender", entity_id=t.id, can_open=can_open_record(db, t),
            )

    # Quotations whose validity ends in 3 days.
    quotation_status.remind_expiring(db, today)


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
