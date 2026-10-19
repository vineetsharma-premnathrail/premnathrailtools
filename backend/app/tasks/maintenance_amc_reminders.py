"""Daily Maintenance warranty / AMC expiry reminders (wired up in
app/main.py, 06:15 IST).

For every live asset (not deleted, not decommissioned) whose warranty or AMC
expires exactly 30, 15, 7 or 1 days from today — or expired yesterday (the
defaults; both day lists are Maintenance › Settings values) — the plant's maintenance planners (work_orders:approve; falls back to every
maintenance user of the plant if none is configured) get one bell + Teams
reminder (it's a reminder, so teams=True). If both covers trigger on the same
day they share one message. Deduplicated per user / asset / day, same shape
as quality_reminders._sent_today."""
import logging
from datetime import date

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.notification import Notification
from app.modules.maintenance.contracts import reminder_due, reminder_sentence
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.settings import contract_reminder_days
from app.modules.maintenance.service import maintenance_planners, maintenance_users_for_branch, today_ist
from app.utils.notifications import notify_user
from app.modules.maintenance.role_events import role_event

logger = logging.getLogger(__name__)

AMC_EXPIRING = "maintenance_amc_expiring"
ASSET_ENTITY = "maintenance_asset"


def _sent_today(db: Session, user_id: int, asset_id: int) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == ASSET_ENTITY,
        Notification.entity_id == asset_id, Notification.notification_type == AMC_EXPIRING,
        func.date(Notification.created_at) == date.today(),
    ).first() is not None


def _vendor_name(db: Session, vendor_id: int | None) -> str | None:
    if not vendor_id:
        return None
    return db.query(Vendor.name).filter(Vendor.id == vendor_id).scalar()


def _send_maintenance_amc_reminders(db: Session, today: date | None = None) -> dict:
    today = today or today_ist()
    assets = db.query(MaintenanceAsset).filter(
        MaintenanceAsset.is_deleted == False,  # noqa: E712
        MaintenanceAsset.status != "decommissioned",
        or_(MaintenanceAsset.warranty_expiry.isnot(None), MaintenanceAsset.amc_expiry.isnot(None)),
    ).all()
    stats = {"assets": 0, "sent": 0, "failed": 0}
    days_before, days_after = contract_reminder_days(db)  # Maintenance › Settings
    recipients_cache: dict[int, list] = {}
    for asset in assets:
        try:
            parts = []
            kinds = []
            if reminder_due(asset.amc_expiry, today, days_before, days_after):
                parts.append(reminder_sentence("amc", asset, _vendor_name(db, asset.amc_vendor_id), asset.amc_expiry, today))
                kinds.append("AMC")
            if reminder_due(asset.warranty_expiry, today, days_before, days_after):
                parts.append(reminder_sentence("warranty", asset, _vendor_name(db, asset.supplier_vendor_id), asset.warranty_expiry, today))
                kinds.append("Warranty")
            if not parts:
                continue
            stats["assets"] += 1
            if asset.branch_id not in recipients_cache:
                users = maintenance_planners(db, asset.branch_id) or maintenance_users_for_branch(db, asset.branch_id)
                recipients_cache[asset.branch_id] = users
            title = f"{' & '.join(kinds)} expiry: {asset.asset_code}"
            message = " ".join(parts)
            fresh = False
            for u in recipients_cache[asset.branch_id]:
                if _sent_today(db, u.id, asset.id):
                    continue
                notify_user(db, user_id=u.id, title=title, message=message, notification_type=AMC_EXPIRING,
                            entity_type=ASSET_ENTITY, entity_id=asset.id, teams=True)
                stats["sent"] += 1
                fresh = True
            if fresh:  # once a day per asset → roles subscribed to maintenance.amc_expiring (bell / Teams)
                role_event(db, None, "amc_expiring", title=title, message=message, entity_type=ASSET_ENTITY, entity_id=asset.id,
                           record=asset, skip_user_ids={u.id for u in recipients_cache[asset.branch_id]})
            db.commit()
        except Exception:
            stats["failed"] += 1
            logger.exception("Maintenance AMC/warranty reminder failed for asset %s", asset.id)
            db.rollback()
    logger.info("maintenance AMC/warranty reminders: %(assets)s assets due, %(sent)s notifications sent, %(failed)s failed", stats)
    return stats


def send_maintenance_amc_reminders() -> None:
    db = SessionLocal()
    try:
        _send_maintenance_amc_reminders(db)
    except Exception:
        logger.exception("Maintenance AMC/warranty reminders failed")
        db.rollback()
    finally:
        db.close()
