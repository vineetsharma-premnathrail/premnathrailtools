"""Daily 00:30 IST (wired in app/main.py): effective-dated HR actions (SAP PA40).

1. Lifecycle events in status 'scheduled' (a transfer / promotion /
   confirmation HR completed before its effective date) whose effective date
   has come are applied with the completion options HR chose, acting as the
   HR user who scheduled them (they passed every check when they scheduled).
2. Future-dated org assignment slices (hr_employee_assignments.applied_at
   NULL) whose valid_from has come are written onto the profile / User.

One failure never stops the rest: it is rolled back, logged and HR is told
(bell only — not an approval or reminder, so no Teams message).
"""
from __future__ import annotations

import logging
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.db.session import SessionLocal
from app.modules.hr.models.lifecycle import HrLifecycleEvent
from app.modules.hr.schemas.lifecycle import HrLifecycleEventCompletePayload
from app.modules.hr.services import assignments as asg
from app.modules.hr.services import lifecycle as svc
from app.modules.hr.services.calendar import today_ist
from app.modules.main.models.user import User

logger = logging.getLogger(__name__)


def apply_scheduled_event(db: Session, ev: HrLifecycleEvent, actor: User | None = None, *, reason: str | None = None) -> dict:
    """Apply one scheduled event now. `actor` = who applies it ('Apply now'),
    default = the HR user who scheduled it. Does not commit."""
    if ev.status != "scheduled":
        raise HTTPException(status_code=409, detail=f"{ev.event_no} is {ev.status}, not scheduled, so there is nothing to apply.")
    info = ev.completion_summary if isinstance(ev.completion_summary, dict) else {}
    if actor is None:
        actor = db.get(User, info.get("scheduled_by_id")) if info.get("scheduled_by_id") else None
        if actor is None:
            raise HTTPException(status_code=409, detail=f"{ev.event_no} has no record of who scheduled it. Open it and use 'Apply now'.")
    payload = HrLifecycleEventCompletePayload(**(info.get("scheduled_payload") or {}))
    if reason:
        payload.remarks = f"Applied early: {reason}" + (f" — {payload.remarks}" if payload.remarks else "")
    return svc.complete_event(db, ev, payload, actor, apply_scheduled=True)


def run_once(db: Session, today: date | None = None) -> dict:
    today = today or today_ist()
    applied, failed = [], []
    due = (db.query(HrLifecycleEvent)
           .filter(HrLifecycleEvent.status == "scheduled", HrLifecycleEvent.effective_date <= today)
           .order_by(HrLifecycleEvent.effective_date, HrLifecycleEvent.id).all())
    for ev in due:
        try:
            with db.begin_nested():
                apply_scheduled_event(db, ev)
            db.commit()
            applied.append(ev.event_no)
        except Exception as e:  # noqa: BLE001 — keep going; report the real reason
            db.rollback()
            reason = e.detail if isinstance(e, HTTPException) else str(e)
            failed.append({"event_no": ev.event_no, "reason": reason})
            logger.warning("hr_lifecycle_apply: %s not applied: %s", ev.event_no, reason)
            try:
                from app.utils.notifications import broadcast_notification

                record_audit(db, entity_type=svc.ENTITY_TYPE, entity_id=ev.id, action="apply_failed", module_key="hr",
                             summary=f"{ev.event_no} could not be applied on its effective date: {reason}")
                broadcast_notification(
                    db, title=f"Scheduled {ev.event_type} not applied: {ev.event_no}",
                    message=f"{ev.event_no} was due on {ev.effective_date:%d-%m-%Y} but couldn't be applied: {reason} "
                            "Fix it and use 'Apply now' on the event.",
                    notification_type="hr_lifecycle_apply_failed", entity_type=svc.ENTITY_TYPE, entity_id=ev.id, app_name="hr",
                )
                db.commit()
            except Exception:  # noqa: BLE001
                db.rollback()
    slices = asg.apply_due(db, today)
    db.commit()
    return {"applied": applied, "failed": failed, "slices_applied": len(slices)}


def run_hr_lifecycle_apply() -> None:
    db = SessionLocal()
    try:
        result = run_once(db)
        if result["applied"] or result["failed"] or result["slices_applied"]:
            logger.info("hr_lifecycle_apply: %s", result)
    except Exception:  # noqa: BLE001
        logger.exception("hr_lifecycle_apply failed")
        db.rollback()
    finally:
        db.close()
