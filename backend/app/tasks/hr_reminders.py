"""Daily HR reminders (wired up in app/main.py's scheduler block).

1. Employee documents (user_documents.expiry_date) expiring in exactly 30
   or 7 days, or today: notifies the employee and every HR user (anyone
   with the `hr` app, admins included). 'HR Only' documents notify HR only.
2. Probation ending within the next 7 days (hr_employee_profiles with
   employment_status onboarding/probation): notifies HR, the reporting
   manager and the employee — once per probation end date, not daily.

Same "one notification per recipient/entity/day" dedup shape as
app/tasks/po_overdue_reminders.py, so a scheduler restart never double-sends."""
import logging
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.modules.main.models.user_document import UserDocument
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.services.access import HR_ONLY_CONFIDENTIALITY, is_hr
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)

DOC_EXPIRING = "hr_document_expiring"
PROBATION_ENDING = "hr_probation_ending"
DOC_REMINDER_DAYS = (30, 7, 0)
PROBATION_WINDOW_DAYS = 7


def _hr_user_ids(db: Session) -> list[int]:
    return [u.id for u in db.query(User).filter(User.is_active.is_(True)).all() if is_hr(u)]


def _sent_since(db: Session, user_id: int, entity_type: str, entity_id: int, ntype: str, since: date) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id,
        Notification.entity_type == entity_type,
        Notification.entity_id == entity_id,
        Notification.notification_type == ntype,
        func.date(Notification.created_at) >= since,
    ).first() is not None


def _fmt(d: date) -> str:
    return d.strftime("%d-%m-%Y")


def _send_document_reminders(db: Session, today: date, hr_ids: list[int]) -> int:
    targets = [today + timedelta(days=n) for n in DOC_REMINDER_DAYS]
    docs = (
        db.query(UserDocument, User)
        .join(User, User.id == UserDocument.user_id)
        .filter(UserDocument.expiry_date.in_(targets), User.is_active.is_(True))
        .all()
    )
    sent = 0
    for doc, owner in docs:
        days = (doc.expiry_date - today).days
        when = "today" if days == 0 else f"in {days} days, on {_fmt(doc.expiry_date)}"
        # An 'HR Only' document is hidden from its owner, so don't reveal it in a reminder either.
        recipients = set(hr_ids) if doc.confidentiality == HR_ONLY_CONFIDENTIALITY else {owner.id, *hr_ids}
        for rid in recipients:
            if _sent_since(db, rid, "user_document", doc.id, DOC_EXPIRING, today):
                continue
            if rid == owner.id:
                title = "Your document is expiring"
                msg = f"Your {doc.document_type} '{doc.document_name}' expires {when}. Renew it and send the new copy to HR."
            else:
                title = "Employee document expiring"
                msg = f"{owner.name}'s {doc.document_type} '{doc.document_name}' expires {when}. Collect the renewed copy and upload it under HR > Employees > {owner.name} > Documents."
            notify_user(db, user_id=rid, title=title, message=msg, notification_type=DOC_EXPIRING,
                        entity_type="user_document", entity_id=doc.id, teams=True)
            sent += 1
    return sent


def _send_probation_reminders(db: Session, today: date, hr_ids: list[int]) -> int:
    rows = (
        db.query(HrEmployeeProfile, User)
        .join(User, User.id == HrEmployeeProfile.user_id)
        .filter(
            User.is_active.is_(True),
            HrEmployeeProfile.employment_status.in_(("onboarding", "probation")),
            HrEmployeeProfile.probation_end_date.isnot(None),
            HrEmployeeProfile.probation_end_date >= today,
            HrEmployeeProfile.probation_end_date <= today + timedelta(days=PROBATION_WINDOW_DAYS),
        )
        .all()
    )
    sent = 0
    for profile, emp in rows:
        end = profile.probation_end_date
        days = (end - today).days
        when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")
        # once per probation end date: anything sent in the window counts
        since = end - timedelta(days=PROBATION_WINDOW_DAYS + 1)
        recipients = {*hr_ids, emp.id}
        if emp.reporting_manager_id:
            recipients.add(emp.reporting_manager_id)
        for rid in recipients:
            if _sent_since(db, rid, "hr_employee_profile", profile.id, PROBATION_ENDING, since):
                continue
            if rid == emp.id:
                title = "Your probation is ending"
                msg = f"Your probation period ends {when} ({_fmt(end)}). HR and your manager will review your confirmation."
            elif rid == emp.reporting_manager_id and rid not in hr_ids:
                title = "Team member's probation ending"
                msg = f"{emp.name}'s probation ends {when} ({_fmt(end)}). Share your confirmation recommendation with HR."
            else:
                title = "Probation ending"
                msg = f"{emp.name}'s probation ends {when} ({_fmt(end)}). Record the confirmation under HR > Lifecycle (New > Confirmation) or extend the probation end date."
            notify_user(db, user_id=rid, title=title, message=msg, notification_type=PROBATION_ENDING,
                        entity_type="hr_employee_profile", entity_id=profile.id, teams=True)
            sent += 1
    return sent


def run_hr_reminders(db: Session, today: date | None = None) -> dict[str, int]:
    """Pure logic over an open session (tests call this directly)."""
    from app.core.module_visibility import RESTRICTED_APPS

    # HR locked (core/module_visibility.py): nobody can open HR to act on a
    # reminder, so don't send any (bell or Teams).
    if "hr" in RESTRICTED_APPS:
        return {"documents": 0, "probation": 0}
    today = today or date.today()
    hr_ids = _hr_user_ids(db)
    docs = _send_document_reminders(db, today, hr_ids)
    probation = _send_probation_reminders(db, today, hr_ids)
    db.commit()
    return {"documents": docs, "probation": probation}


def send_hr_reminders() -> None:
    """Scheduler entry point — opens its own DB session."""
    db = SessionLocal()
    try:
        result = run_hr_reminders(db)
        logger.info("HR reminders sent: %s", result)
    except Exception:
        db.rollback()
        logger.exception("Failed to send HR reminders")
    finally:
        db.close()
