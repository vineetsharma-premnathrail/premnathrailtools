"""Hourly service-request SLA check (wired up in app/main.py).

For every live SR with an SLA clock still running (erp/sla.py):
  * at 80 % of the response / resolution window → "about to breach"
    reminder to the SR owner (assigned engineer + creator);
  * past the due time → the clock is flagged breached (sla_*_met = False)
    and an escalation reminder goes to the owner AND the service heads
    (Service › Settings › Edit holders).
Reminders are Teams + bell (reminder-type), once per SR / clock / stage."""
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.erp import sla
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.utils.notifications import notify_user
from app.modules.erp.notify import role_event

logger = logging.getLogger(__name__)

WARN = {"response": "erp_sla_response_warning", "resolution": "erp_sla_resolution_warning"}
BREACH = {"response": "erp_sla_response_breach", "resolution": "erp_sla_resolution_breach"}


def service_heads(db: Session) -> list[User]:
    from app.core.permission_registry import can_perform
    return [u for u in db.query(User).filter(User.is_active == True).all()  # noqa: E712
            if u.role != "admin" and "erp" in u.get_apps() and can_perform(u, "erp", "settings", "edit")]


def _sent(db: Session, user_id: int, sr_id: int, ntype: str) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == "service_request",
        Notification.entity_id == sr_id, Notification.notification_type == ntype,
    ).first() is not None


def _fmt(dt) -> str:
    from datetime import timedelta, timezone
    return sla._aware(dt).astimezone(timezone(timedelta(hours=5, minutes=30))).strftime("%d-%m-%Y %H:%M")


def check_sla(db: Session, now: datetime | None = None) -> dict[str, int]:
    now = now or sla.now_utc()
    counts = {"warned": 0, "breached": 0}
    heads = None
    srs = db.query(ServiceRequest).filter(
        ServiceRequest.is_deleted == False, ~ServiceRequest.status.in_(("closed", "cancelled")),  # noqa: E712
    ).all()
    for sr in srs:
        try:
            for clock in ("response", "resolution"):
                done = sr.first_response_at if clock == "response" else sr.resolution_at
                due = sr.sla_response_due_at if clock == "response" else sr.sla_resolution_due_at
                if done is not None or due is None:
                    continue
                state = sla.clock_state(due, None, None, sr.opened_at or sr.created_at, now=now)
                owners = {i for i in (sr.assigned_service_person_id, sr.created_by_id) if i}
                if state == "breached":
                    setattr(sr, f"sla_{clock}_met", False)
                    if heads is None:
                        heads = [u.id for u in service_heads(db)]
                    title = f"SLA breached: {sr.request_number} {clock}"
                    msg = (f"{sr.issue_title} — the {clock} was due {_fmt(due)} IST ({(sr.priority or 'standard').title()} "
                           f"SLA) and is overdue. " + ("Nobody is assigned yet. " if not sr.assigned_service_person_id else "")
                           + ("Attend the site / update the SR now." if clock == "response" else "Complete the work or record why it's delayed."))
                    fresh = False
                    for uid in owners | set(heads):
                        if not _sent(db, uid, sr.id, BREACH[clock]):
                            notify_user(db, uid, title, msg, BREACH[clock], entity_type="service_request", entity_id=sr.id, teams=True)
                            counts["breached"] += 1
                            fresh = True
                    if fresh:  # first breach notice → roles subscribed to erp.sr_sla_alert
                        role_event(db, None, "sr_sla_alert", title=title, message=msg, entity_type="service_request",
                                   entity_id=sr.id, actor=None, record=sr, skip_user_ids=owners | set(heads))
                elif state == "at_risk":
                    title = f"SLA at risk: {sr.request_number} {clock}"
                    msg = f"{sr.issue_title} — the {clock} is due {_fmt(due)} IST. Act before it breaches."
                    fresh = False
                    for uid in owners:
                        if not _sent(db, uid, sr.id, WARN[clock]):
                            notify_user(db, uid, title, msg, WARN[clock], entity_type="service_request", entity_id=sr.id, teams=True)
                            counts["warned"] += 1
                            fresh = True
                    if fresh:
                        role_event(db, None, "sr_sla_alert", title=title, message=msg, entity_type="service_request",
                                   entity_id=sr.id, actor=None, record=sr, skip_user_ids=owners)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("SLA check failed for service request #%s", sr.id)
    return counts


def run_erp_sla_reminders() -> None:
    db = SessionLocal()
    try:
        counts = check_sla(db)
        logger.info("Service SLA check: %s at-risk reminder(s), %s breach escalation(s)", counts["warned"], counts["breached"])
    except Exception:
        logger.exception("Service SLA check failed")
        db.rollback()
    finally:
        db.close()
