"""Daily Maintenance PM scheduler (wired up in app/main.py, 06:00 IST).

1. Generation: for every active plan whose next due date minus lead days has
   arrived and that has no open work order, raise the PM work order
   (service.run_pm_plan → generate_pm_work_order — the same code as the
   "Generate now" button). Idempotent on (plan, due date), so a restart or a
   second run on the same day creates nothing new. An occurrence whose work
   order was cancelled is skipped: the plan moves on one interval instead.
2. Overdue reminders: PM work orders still open past their due date → the
   assignee and the plant's maintenance planners, Teams + bell (it's a
   reminder), once per user / work order / day.

See docs/02-modules/maintenance/plan.md §5.3."""
import logging
from datetime import date

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.main.models.notification import Notification
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.pm_plan import MaintenancePmPlan
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder, MAINTENANCE_WO_OPEN_STATUSES
from app.modules.maintenance.service import PM_OVERDUE, run_pm_plan, today_ist, pm_overdue_recipients
from app.utils.notifications import notify_user
from app.modules.maintenance.role_events import role_event

logger = logging.getLogger(__name__)


def _sent_today(db: Session, user_id: int, wo_id: int, today: date) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == "maintenance_work_order",
        Notification.entity_id == wo_id, Notification.notification_type == PM_OVERDUE,
        func.date(Notification.created_at) == today,
    ).first() is not None


def generate_due_pm_work_orders(db: Session, today: date | None = None) -> dict[str, int]:
    """Step 1. Each plan is committed on its own so one bad plan can't stop
    (or roll back) the rest."""
    today = today or today_ist()
    counts = {"generated": 0, "open_exists": 0, "waiting_close": 0, "not_due": 0, "asset_inactive": 0, "failed": 0}
    rows = db.query(MaintenancePmPlan.id, MaintenancePmPlan.plan_code, MaintenanceAsset.asset_code,
                    MaintenanceAsset.is_deleted, MaintenanceAsset.status).join(
        MaintenanceAsset, MaintenanceAsset.id == MaintenancePmPlan.asset_id,
    ).filter(
        MaintenancePmPlan.is_active == True, MaintenancePmPlan.is_deleted == False,  # noqa: E712
    ).order_by(MaintenancePmPlan.id).all()
    for pid, plan_code, asset_code, asset_deleted, asset_status in rows:
        if asset_deleted or asset_status == "decommissioned":
            # A retired machine isn't a failure — the plan just shouldn't be active.
            counts["asset_inactive"] += 1
            logger.info("PM %s skipped: asset %s is %s — deactivate the plan.", plan_code, asset_code,
                        "deleted" if asset_deleted else "decommissioned")
            continue
        try:
            plan = db.query(MaintenancePmPlan).filter(MaintenancePmPlan.id == pid).first()
            outcome, wo = run_pm_plan(db, plan, today=today)
            db.commit()
            counts[outcome] = counts.get(outcome, 0) + 1
            if outcome == "generated" and wo is not None:
                logger.info("PM %s: generated %s due %s", plan.plan_code, wo.wo_number, wo.pm_due_date)
        except IntegrityError:
            # Someone ("Generate now") raised the same occurrence a moment ago —
            # the unique (plan, due date) constraint caught it. Not a failure.
            db.rollback()
            counts["open_exists"] += 1
            logger.info("PM %s: job for this due date was generated concurrently — skipped", plan_code)
        except Exception:
            db.rollback()
            counts["failed"] += 1
            logger.exception("PM scheduler: plan #%s failed", pid)
    return counts


def send_pm_overdue_reminders(db: Session, today: date | None = None) -> int:
    """Step 2."""
    today = today or today_ist()
    wos = db.query(MaintenanceWorkOrder).join(
        MaintenanceAsset, MaintenanceAsset.id == MaintenanceWorkOrder.asset_id,
    ).filter(
        MaintenanceAsset.is_deleted == False, MaintenanceAsset.status != "decommissioned",  # noqa: E712
        MaintenanceWorkOrder.pm_plan_id.isnot(None),
        MaintenanceWorkOrder.status.in_(MAINTENANCE_WO_OPEN_STATUSES),
        MaintenanceWorkOrder.pm_due_date < today,
    ).all()
    sent = 0
    for wo in wos:
        try:
            asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == wo.asset_id).first()
            days = (today - wo.pm_due_date).days
            title = f"PM overdue: {wo.wo_number}"
            msg = (f"{asset.asset_code + ' — ' if asset else ''}{wo.title} was due {wo.pm_due_date:%d-%m-%Y} "
                   f"({days} day{'s' if days != 1 else ''} ago) and is still {wo.status.replace('_', ' ')}."
                   + ("" if wo.assigned_to_id else " Nobody is assigned yet.")
                   + " Complete it or reschedule the job.")
            recipients = set(pm_overdue_recipients(db, wo, asset.branch_id if asset else None))
            fresh = False
            for uid in recipients:
                if _sent_today(db, uid, wo.id, today):
                    continue
                notify_user(db, user_id=uid, title=title, message=msg, notification_type=PM_OVERDUE,
                            entity_type="maintenance_work_order", entity_id=wo.id, teams=True)
                sent += 1
                fresh = True
            if fresh:  # once a day per job → roles subscribed to maintenance.pm_overdue (bell / Teams)
                role_event(db, None, "pm_overdue", title=title, message=msg, entity_type="maintenance_work_order",
                           entity_id=wo.id, record=wo, skip_user_ids=recipients)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("PM overdue reminder failed for work order #%s", wo.id)
    return sent


def run_maintenance_pm_scheduler() -> None:
    db = SessionLocal()
    try:
        today = today_ist()
        counts = generate_due_pm_work_orders(db, today)
        reminders = send_pm_overdue_reminders(db, today)
        logger.info(
            "Maintenance PM scheduler: %s generated, %s already open, %s awaiting close, %s not due, "
            "%s on retired assets, %s failed; %s overdue reminder(s) sent",
            counts.get("generated", 0), counts.get("open_exists", 0), counts.get("waiting_close", 0),
            counts.get("not_due", 0), counts.get("asset_inactive", 0), counts.get("failed", 0), reminders,
        )
    except Exception:
        logger.exception("Maintenance PM scheduler failed")
        db.rollback()
    finally:
        db.close()
