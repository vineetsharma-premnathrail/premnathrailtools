"""Daily Quality reminders (wired up in app/main.py).

- Inspection lot waiting longer than Quality → Settings "lot_waiting_days"
  → quality engineers (Teams + bell; it's a reminder).
- NCR disposition still waiting for approval after the same number of days
  → reminds the pending approvers (via services.ncr._notify_approvers rules).
- Customer / third-party inspection call date within
  "inspection_call_reminder_days" → quality engineers (Teams + bell).

Deduplicated per user / entity / day, same shape as po_overdue_reminders."""
import logging
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.main.models.notification import Notification
from app.modules.quality.models.inspection_lot import QualityInspectionLot, QUALITY_LOT_OPEN_STATUSES
from app.modules.quality.services import access
from app.modules.quality.services.settings import get_setting
from app.utils.notifications import notify_user, broadcast_notification

logger = logging.getLogger(__name__)

LOT_WAITING = "quality_lot_waiting"
CALL_DUE = "quality_inspection_call_due"


def _sent_today(db: Session, user_id: int, lot_id: int, entity_type: str = "quality_inspection_lot",
                notification_type: str = LOT_WAITING) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == entity_type,
        Notification.entity_id == lot_id, Notification.notification_type == notification_type,
        func.date(Notification.created_at) == date.today(),
    ).first() is not None


def _send_call_reminders(db: Session, engineers) -> int:
    from app.modules.quality.services.inspection_calls import due_for_reminder
    sent = 0
    for call in due_for_reminder(db, int(get_setting(db, "inspection_call_reminder_days"))):
        days = (call.call_date - date.today()).days
        when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days ({call.call_date:%d-%m-%Y})")
        title = "Inspection Call Coming Up"
        msg = (f"{call.call_number}: {call.agency.upper()} inspection of {call.quantity:g} {call.uom or ''} {call.item_name}"
               + (f" for order {call.order_reference}" if call.order_reference else "")
               + f" is {when}" + (f" (inspector {call.inspector_name})" if call.inspector_name else "")
               + ". Keep the material, test certificates and our final inspection report ready.")
        if not engineers:
            broadcast_notification(db, title=title, message=msg, notification_type=CALL_DUE,
                                   entity_type="quality_inspection_call", entity_id=call.id, app_name="quality", teams=True)
            sent += 1
            continue
        for u in engineers:
            if _sent_today(db, u.id, call.id, "quality_inspection_call", CALL_DUE):
                continue
            notify_user(db, user_id=u.id, title=title, message=msg, notification_type=CALL_DUE,
                        entity_type="quality_inspection_call", entity_id=call.id, teams=True)
            sent += 1
    return sent


def _send_quality_reminders(db: Session) -> int:
    days = int(get_setting(db, "lot_waiting_days"))
    cutoff = date.today() - timedelta(days=days)
    lots = db.query(QualityInspectionLot).filter(
        QualityInspectionLot.status.in_(QUALITY_LOT_OPEN_STATUSES), QualityInspectionLot.lot_date < cutoff,
    ).all()
    engineers = access.quality_engineers(db)
    sent = 0
    for lot in lots:
        age = (date.today() - lot.lot_date).days
        title = "Inspection Lot Waiting Too Long"
        msg = (f"Lot {lot.lot_number} ({lot.item_name}, {lot.quantity:g} {lot.uom or ''}) has been waiting {age} days "
               f"(status: {lot.status.replace('_', ' ')}). Material is held in Quality stock until it is decided.")
        if not engineers:
            broadcast_notification(db, title=title, message=msg, notification_type=LOT_WAITING,
                                   entity_type="quality_inspection_lot", entity_id=lot.id, app_name="quality", teams=True)
            sent += 1
            continue
        for u in engineers:
            if _sent_today(db, u.id, lot.id):
                continue
            notify_user(db, user_id=u.id, title=title, message=msg, notification_type=LOT_WAITING,
                        entity_type="quality_inspection_lot", entity_id=lot.id, teams=True)
            sent += 1
    sent += _send_call_reminders(db, engineers)
    db.commit()
    return sent


def send_quality_reminders() -> None:
    db = SessionLocal()
    try:
        _send_quality_reminders(db)
    except Exception:
        logger.exception("Quality reminders failed")
        db.rollback()
    finally:
        db.close()
