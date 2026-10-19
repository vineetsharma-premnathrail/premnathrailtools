"""Daily bank guarantee / LC / EMD expiry reminders (wired up in app/main.py,
07:00 IST).

For every active instrument whose expiry or claim-period end is 30, 15, 7
or 1 day(s) away — or that expired and is still open (weekly nag) — the
person who recorded it and every holder of accounts:guarantees:edit get one
bell + Teams reminder (a reminder, so teams=True). Deduplicated per user /
instrument / day."""
import logging
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permission_registry import permission_id
from app.db.session import SessionLocal
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.modules.accounts.models.bank_guarantee import BG_INSTRUMENT_TYPES
from app.modules.accounts.services.guarantees import ET_GUARANTEE, due_for_reminder
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)
NOTIFICATION_TYPE = "accounts_bg_expiring"


def _recipients(db: Session, bg, editors: list[User]) -> list[User]:
    seen = {u.id: u for u in editors}
    if bg.created_by_id and bg.created_by_id not in seen:
        u = db.query(User).filter(User.id == bg.created_by_id, User.is_active.is_(True)).first()
        if u:
            seen[u.id] = u
    return list(seen.values())


def _sent_today(db: Session, user_id: int, bg_id: int) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == ET_GUARANTEE, Notification.entity_id == bg_id,
        Notification.notification_type == NOTIFICATION_TYPE, func.date(Notification.created_at) == date.today(),
    ).first() is not None


def run_bank_guarantee_reminders(db: Session, today: date | None = None) -> dict:
    today = today or date.today()
    stats = {"instruments": 0, "sent": 0, "failed": 0}
    pid = permission_id("accounts", "guarantees", "edit")
    editors = [u for u in db.query(User).filter(User.is_active.is_(True)).all() if pid in u.effective_permissions]
    for bg, reasons in due_for_reminder(db, today):
        try:
            stats["instruments"] += 1
            kind = BG_INSTRUMENT_TYPES.get(bg.instrument_type, bg.instrument_type)
            party = bg.counterparty_name or ""
            title = f"{kind} {bg.instrument_number or bg.bg_number}: {reasons[0].split(' (')[0]}"
            message = (f"{bg.bg_number} ({kind}{f' for {party}' if party else ''}, {bg.amount:,.2f}) "
                       f"{'; '.join(reasons)}. Extend it with the bank, or release it once the original is back.")
            direct = _recipients(db, bg, editors)
            for u in direct:
                if _sent_today(db, u.id, bg.id):
                    continue
                notify_user(db, user_id=u.id, title=title[:200], message=message, notification_type=NOTIFICATION_TYPE,
                            entity_type=ET_GUARANTEE, entity_id=bg.id, teams=True)
                stats["sent"] += 1
            # Role event (core/events/accounts_b.py) for subscribed roles; the
            # people reminded directly above are skipped. No email from a job.
            from app.modules.accounts import role_events_b
            role_events_b.fire(db, "guarantee_expiring", title=title, message=message, entity_type=ET_GUARANTEE,
                               entity_id=bg.id, record=bg, skip={u.id for u in direct})
            db.commit()
        except Exception:
            stats["failed"] += 1
            logger.exception("Bank guarantee reminder failed for %s", bg.id)
            db.rollback()
    logger.info("bank guarantee reminders: %(instruments)s due, %(sent)s sent, %(failed)s failed", stats)
    return stats


def send_bank_guarantee_reminders() -> None:
    db = SessionLocal()
    try:
        run_bank_guarantee_reminders(db)
    except Exception:
        logger.exception("Bank guarantee reminders failed")
        db.rollback()
    finally:
        db.close()
