"""Daily gauge calibration reminders (wired up in app/main.py).

Gauges due within Quality › Settings "gauge_due_days" (default 15) or
already overdue → the gauge custodian, else the quality engineers (Teams +
bell; it's a reminder). Deduplicated per user / gauge / day."""
import logging
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.main.models.notification import Notification
from app.modules.quality.services import access
from app.modules.quality.services.gauges import due_soon
from app.modules.quality.services.settings import get_setting
from app.utils.notifications import broadcast_notification, notify_user

logger = logging.getLogger(__name__)

GAUGE_DUE = "quality_gauge_calibration_due"


def _sent_today(db: Session, user_id: int, gauge_id: int) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == "quality_gauge", Notification.entity_id == gauge_id,
        Notification.notification_type == GAUGE_DUE, func.date(Notification.created_at) == date.today(),
    ).first() is not None


def send_gauge_reminders_db(db: Session) -> int:
    try:
        days = int(get_setting(db, "gauge_due_days"))
    except Exception:  # noqa: BLE001 — setting missing on an old database
        days = 15
    engineers = access.quality_engineers(db)
    sent = 0
    for g in due_soon(db, days):
        left = (g.next_due_on - date.today()).days
        when = (f"was due {g.next_due_on:%d-%m-%Y} ({-left} day(s) overdue) — it is blocked for results recording"
                if left < 0 else ("is due today" if left == 0 else f"is due on {g.next_due_on:%d-%m-%Y} (in {left} day(s))"))
        title = "Gauge Calibration Due"
        msg = (f"Gauge {g.code} ({g.name}{', ' + g.location if g.location else ''}) {when}. "
               "Send it for calibration and record the result in Quality › Gauges.")
        recipients = [g.custodian_id] if g.custodian_id else [u.id for u in engineers]
        # Role-based (core/events/quality.py): bell / Teams only from a job, once per gauge per day.
        from app.modules.quality.services import role_events
        sent += len(role_events.fire(db, "gauge_calibration_due", record=g, entity_type="quality_gauge",
                                     skip=set(recipients), once_today=True, title=f"Gauge calibration due: {g.code}", message=msg))
        if not recipients:
            broadcast_notification(db, title=title, message=msg, notification_type=GAUGE_DUE,
                                   entity_type="quality_gauge", entity_id=g.id, app_name="quality", teams=True)
            sent += 1
            continue
        for uid in recipients:
            if _sent_today(db, uid, g.id):
                continue
            notify_user(db, user_id=uid, title=title, message=msg, notification_type=GAUGE_DUE,
                        entity_type="quality_gauge", entity_id=g.id, teams=True)
            sent += 1
    db.commit()
    return sent


def send_gauge_reminders() -> None:
    db = SessionLocal()
    try:
        send_gauge_reminders_db(db)
    except Exception:
        logger.exception("Gauge calibration reminders failed")
        db.rollback()
    finally:
        db.close()
