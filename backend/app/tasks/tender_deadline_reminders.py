"""Tender last-date reminders (called from the daily CRM job, tasks/followup_reminders.py).

A live tender's last date is its closing date-time (`closing_at`), else its
submission date. 7, 3 and 1 day(s) before it, the person who created the
tender and its BD owner get a bell + Teams reminder and an email; roles
subscribed to crm.tender_submission_due get it on their own channels.
Each milestone reaches a person once (per user / tender / title)."""
import asyncio
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.notification_events import notify_event
from app.modules.crm.models.tender import Tender
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)
NOTIFICATION_TYPE = "crm_tender_deadline"
TENDER_DUE_DAYS = (7, 3, 1)
# Statuses after which the bid no longer needs a nudge.
_DONE_PREFIXES = ("Closed", "Tender Cancelled", "Tender Submitted")


def last_date(t: Tender) -> date | None:
    return t.closing_at.date() if t.closing_at else t.submission_date


def _last_date_text(t: Tender) -> str:
    if t.closing_at:
        return t.closing_at.strftime("%d-%m-%Y %I:%M %p")
    return t.submission_date.strftime("%d-%m-%Y")


def _people(db: Session, t: Tender) -> list[User]:
    """Creator + BD owner (a typed name, matched to an active user)."""
    found: dict[int, User] = {}
    if t.created_by_id:
        u = db.query(User).filter(User.id == t.created_by_id, User.is_active.is_(True)).first()
        if u:
            found[u.id] = u
    if (t.bd_owner or "").strip():
        u = db.query(User).filter(func.lower(User.name) == t.bd_owner.strip().lower(), User.is_active.is_(True)).first()
        if u:
            found[u.id] = u
    return list(found.values())


def _already_sent(db: Session, user_id: int, tender_id: int, title: str) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == "tender", Notification.entity_id == tender_id,
        Notification.notification_type == NOTIFICATION_TYPE, Notification.title == title,
    ).first() is not None


def run_tender_deadline_reminders(db: Session, today: date | None = None, send_email: bool = True) -> dict:
    from app.core.notify_rules import _send_emails
    from app.modules.crm.access import can_open_record

    today = today or date.today()
    stats = {"tenders": 0, "sent": 0, "failed": 0}
    horizon_end = today + timedelta(days=max(TENDER_DUE_DAYS))
    candidates = db.query(Tender).filter(
        Tender.is_deleted == False,  # noqa: E712
        or_(
            (Tender.closing_at >= datetime.combine(today, datetime.min.time()))
            & (Tender.closing_at < datetime.combine(horizon_end + timedelta(days=1), datetime.min.time())),
            Tender.closing_at.is_(None) & (Tender.submission_date >= today) & (Tender.submission_date <= horizon_end),
        ),
    ).all()
    for t in candidates:
        due = last_date(t)
        days = (due - today).days if due else None
        if days not in TENDER_DUE_DAYS or (t.status or "").startswith(_DONE_PREFIXES):
            continue
        try:
            stats["tenders"] += 1
            name = t.tender_name or t.tender_number or t.universal_id
            title = f"Tender {t.universal_id} closes in {days} day{'s' if days != 1 else ''}"
            message = (f"Tender {name} ({t.organization.name if t.organization else 'customer'}) closes on "
                       f"{_last_date_text(t)} (status: {t.status}). Finish the bid documents and submit it before then.")
            emails: dict[str, str] = {}
            direct = _people(db, t)
            for u in direct:
                if _already_sent(db, u.id, t.id, title[:200]):
                    continue
                notify_user(db, user_id=u.id, title=title[:200], message=message, notification_type=NOTIFICATION_TYPE,
                            entity_type="tender", entity_id=t.id, teams=True)
                if u.email:
                    emails[u.email.lower()] = u.name or u.email
                stats["sent"] += 1
            notify_event(db, None, "crm", "tender_submission_due", title=title, message=message,
                         entity_type="tender", entity_id=t.id, can_open=can_open_record(db, t),
                         skip_user_ids={u.id for u in direct})
            db.commit()
            if emails and send_email:
                details = [("Tender", name or ""), ("Tender no.", t.tender_number or ""),
                           ("Last date", _last_date_text(t)), ("Status", t.status or "")]
                asyncio.run(_send_emails("crm", title, message, details, emails))
        except Exception:
            stats["failed"] += 1
            logger.exception("Tender deadline reminder failed for %s", t.id)
            db.rollback()
    logger.info("tender deadline reminders: %(tenders)s due, %(sent)s sent, %(failed)s failed", stats)
    return stats
