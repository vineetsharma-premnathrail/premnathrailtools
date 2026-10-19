"""Daily Sales delivery job (plan §6.6 / §12; wired up in app/main.py, 06:30 IST).

For every confirmed / in-execution order: re-derive each delivery row's status
from its build, recompute accrued LD and the risk flag. A row that turns
at-risk, or is overdue, reminds the SO owner and the Sales Head (bell + Teams,
it's a reminder). Orders waiting for approval more than 2 days remind the
pending approver. Every reminder is sent at most once per user / entity /
type / day, so re-running the job the same day is harmless."""
import logging
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.db.session import SessionLocal
from app.modules.main.models.notification import Notification
from app.modules.organization.services import approval_engine as engine
from app.modules.sales import approvals as sales_approvals
from app.modules.sales import service as svc
from app.modules.sales import events as sales_events
from app.modules.sales.models.order import SalesOrder

logger = logging.getLogger(__name__)

AT_RISK = "sales_delivery_at_risk"
OVERDUE = "sales_delivery_overdue"
APPROVAL_REMINDER = "sales_approval_pending_reminder"


def _sent_today(db: Session, user_id: int, entity_id: int, ntype: str, today: date) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == "sales_order", Notification.entity_id == entity_id,
        Notification.notification_type == ntype, func.date(Notification.created_at) == today,
    ).first() is not None


def _remind(db: Session, user_ids, so: SalesOrder, ntype: str, title: str, message: str, today: date) -> int:
    sent = 0
    for uid in {u for u in user_ids if u}:
        if _sent_today(db, uid, so.id, ntype, today):
            continue
        svc.notify_user(db, uid, title, message, ntype, entity_type="sales_order", entity_id=so.id, teams=True)
        sent += 1
    return sent


def run_for(db: Session, today: date | None = None) -> dict:
    today = today or svc.today_ist()
    window = int(svc.get_setting(db, "at_risk_reminder_days"))
    stats = {"orders": 0, "at_risk": 0, "overdue": 0, "reminders": 0}
    heads = svc.sales_head_ids(db)
    orders = db.query(SalesOrder).options(selectinload(SalesOrder.lines), selectinload(SalesOrder.schedules)).filter(
        SalesOrder.is_deleted == False,  # noqa: E712
        SalesOrder.status.in_(("confirmed", "in_execution", "partially_delivered", "on_hold")),
    ).all()
    for so in orders:
        stats["orders"] += 1
        svc.refresh_order(db, so, today)
        newly_at_risk, overdue, newly_overdue = [], [], []
        for row in so.schedules:
            risk = svc.risk_of(db, so, row, today, window)
            if risk == "at_risk" and row.risk_flag != "at_risk":
                newly_at_risk.append(row)
            if risk == "overdue":
                overdue.append(row)
                if row.risk_flag != "overdue":
                    newly_overdue.append(row)
            row.risk_flag = risk
        recipients = [so.sales_owner_id, *heads]
        # Role subscribers (Sales › Delivery) hear once per change — the owner and
        # Sales Heads keep their daily reminder below. A job has no background
        # task, so these go by bell / Teams only.
        if newly_at_risk:
            sales_events.order_event(
                db, None, "delivery_at_risk", so, title=f"{so.display_number}: delivery at risk",
                message=f"{len(newly_at_risk)} vehicle(s) of {so.display_number} ({so.customer_name or 'customer'}) may miss the contractual date "
                        f"(first due {min(r.current_delivery_date for r in newly_at_risk):%d-%m-%Y}). Prioritise the build or apply for a DP extension.",
                skip_user_ids=set(recipients),
            )
        if newly_overdue:
            sales_events.order_event(
                db, None, "delivery_overdue", so, title=f"{so.display_number}: {len(newly_overdue)} vehicle(s) now overdue",
                message=f"{len(newly_overdue)} vehicle(s) of {so.display_number} ({so.customer_name or 'customer'}) passed the contractual date "
                        f"undelivered — LD is running. Record a DP extension if the customer caused the delay.",
                skip_user_ids=set(recipients),
            )
        if newly_at_risk:
            stats["at_risk"] += len(newly_at_risk)
            stats["reminders"] += _remind(db, recipients, so, AT_RISK, f"{so.display_number}: delivery at risk",
                                          f"{len(newly_at_risk)} vehicle(s) may miss the contractual date "
                                          f"(first due {min(r.current_delivery_date for r in newly_at_risk):%d-%m-%Y}). "
                                          f"Prioritise the build or apply for a DP extension.", today)
        if overdue:
            stats["overdue"] += len(overdue)
            # Clamp at the cap left after LD already accrued on delivered vehicles (shared contract-value cap).
            ld, _fc = svc.order_open_ld(so, sum(svc.ld_accrued(so, r, today)[1] for r in overdue), 0, today)
            stats["reminders"] += _remind(db, recipients, so, OVERDUE, f"{so.display_number}: {len(overdue)} vehicle(s) overdue",
                                          f"LD accrued so far {svc.inr(ld)}. Record a DP extension if the customer caused the delay.", today)
        db.commit()
    cutoff = svc.now_utc() - timedelta(days=2)
    for so in db.query(SalesOrder).filter(SalesOrder.is_deleted == False, SalesOrder.status == "pending_approval",  # noqa: E712
                                          SalesOrder.submitted_at < cutoff).all():
        req = engine.latest_request(db, sales_approvals.ORDER_ENTITY, so.id)
        if req is not None:
            # Central approval engine: remind whoever holds the current stage
            # (plus anyone it was escalated to).
            if req.status != "pending":
                continue
            steps = [st for st in req.steps if st.sequence == req.current_sequence and st.status == "pending"]
            if not steps:
                continue
            ids = {st.approver_id for st in steps} | {u for st in steps for u in (st.escalated_to_ids or [])}
            label = steps[0].stage_name or "approver"
        else:
            # Legacy chain (orders submitted before the move to the engine).
            lvl = svc.next_level(db, "sales_order", so.id, so.approval_round, so.required_approval_level)
            if not lvl:
                continue
            ids = {u.id for u in svc.level_holders(db, lvl) if u.id != so.submitted_by_id}
            label = svc.LEVEL_LABEL[lvl]
        stats["reminders"] += _remind(db, ids, so, APPROVAL_REMINDER, f"Reminder: approve {so.display_number}",
                                      f"{so.customer_name}: {svc.inr(so.grand_total)} has been waiting for the "
                                      f"{label}'s approval since {svc._aware(so.submitted_at):%d-%m-%Y}.", today)
        db.commit()
    # CRM quotations whose validity ended without a customer decision → expired.
    from app.modules.crm.services import quotation_status
    stats["quotations_expired"] = quotation_status.expire_due(db, today)
    db.commit()
    return stats


def run_sales_scheduler() -> None:
    db = SessionLocal()
    try:
        logger.info("Sales scheduler: %s", run_for(db))
    except Exception:
        db.rollback()
        logger.exception("Sales scheduler failed")
    finally:
        db.close()
