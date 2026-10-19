"""Daily Quality reminders (wired up in app/main.py).

- Inspection lot waiting longer than Quality → Settings "lot_waiting_days"
  → quality engineers (Teams + bell; it's a reminder).
- NCR disposition / inspection plan / vendor block approvals are reminded
  and escalated by the central approval engine (Organization › Approval
  Workflows → stage "escalate after" hours), not here.
- Customer / third-party inspection call date within
  "inspection_call_reminder_days" → quality engineers (Teams + bell).
- CAPA action past its due date → action owner + Quality heads (Teams + bell).
- CAPA effectiveness check (D8) due → CAPA owner + Quality heads (Teams + bell).
- Vendor rating: the previous month is rated automatically once (on the
  first run of a new month), which also escalates vendors below the limits.

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


CAPA_ACTION_OVERDUE = "quality_capa_action_overdue"
CAPA_EFFECTIVENESS_DUE = "quality_capa_effectiveness_due"


def _send_capa_reminders(db: Session) -> int:
    from app.modules.quality.services.capa import overdue_actions, effectiveness_due
    heads = [u.id for u in access.quality_heads(db)]
    sent = 0
    role_fired: set[int] = set()
    for capa, act in overdue_actions(db):
        days = (date.today() - act.due_date).days
        msg = (f"{capa.capa_number}: action '{act.description[:120]}' was due {act.due_date:%d-%m-%Y} ({days} day(s) overdue). "
               "Complete it and record the evidence on the CAPA, or agree a new plan with the Quality head.")
        for uid in {act.owner_id, *heads}:
            # One reminder per user per CAPA per day, however many actions are late.
            if _sent_today(db, uid, capa.id, "quality_capa", CAPA_ACTION_OVERDUE):
                continue
            notify_user(db, user_id=uid, title="CAPA Action Overdue", message=msg, notification_type=CAPA_ACTION_OVERDUE,
                        entity_type="quality_capa", entity_id=capa.id, teams=True)
            sent += 1
        if capa.id not in role_fired:  # role-based (core/events/quality.py): once per CAPA per day, bell / Teams only
            role_fired.add(capa.id)
            from app.modules.quality.services import role_events
            sent += len(role_events.fire(db, "capa_action_overdue", record=capa, entity_type="quality_capa",
                                         skip={act.owner_id, *heads}, once_today=True,
                                         title=f"CAPA action overdue: {capa.capa_number}", message=msg))
    for capa in effectiveness_due(db):
        msg = (f"{capa.capa_number}: the effectiveness check (D8) was due on {capa.effectiveness_due_date:%d-%m-%Y}. "
               "Verify the problem has not come back and close the CAPA (or mark it not effective).")
        for uid in {capa.responsible_user_id, *heads} - {None}:
            if _sent_today(db, uid, capa.id, "quality_capa", CAPA_EFFECTIVENESS_DUE):
                continue
            notify_user(db, user_id=uid, title="CAPA Effectiveness Check Due", message=msg,
                        notification_type=CAPA_EFFECTIVENESS_DUE, entity_type="quality_capa", entity_id=capa.id, teams=True)
            sent += 1
    return sent


def _rate_previous_month(db: Session) -> int:
    from app.modules.quality.services.supplier_quality import ensure_period_rated, previous_period
    try:
        with db.begin_nested():  # a failure rolls back only the rating
            return ensure_period_rated(db, previous_period())
    except Exception:  # noqa: BLE001 — never let the rating stop the reminders
        logger.exception("Monthly vendor rating failed")
        return 0


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
    sent += _send_capa_reminders(db)
    _rate_previous_month(db)
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
