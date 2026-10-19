"""Daily Service-contract job (wired up in app/main.py, 06:20 IST).

1. Expiry: active contracts past their end date become 'expired' (the
   machines' AMC mirror follows).
2. Renewal reminders: an active contract ending in exactly 60, 30 or 7 days
   and not yet renewed — bell + Teams (a reminder, so teams=True) to its
   creator and to the holders of Service › Service Contracts › edit.
   Deduplicated per user / contract / day.
3. Billing: planned billing lines of active contracts whose due date has
   come get their AR invoice drafted (Finance approves and posts it). A
   line that can't be drafted (e.g. the customer has no GSTIN) is skipped
   and its creator is told why — once a day."""
import logging
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.erp import contracts as svc
from app.modules.erp.models.service_contract import ServiceContract, ServiceContractBilling
from app.modules.main.models.notification import Notification
from app.utils.notifications import notify_user
from app.modules.erp.notify import role_event

logger = logging.getLogger(__name__)

EXPIRING = "erp_contract_expiring"
BILLING_FAILED = "erp_contract_billing_failed"


def _sent_today(db: Session, user_id: int, contract_id: int, ntype: str, today: date) -> bool:
    return db.query(Notification.id).filter(
        Notification.user_id == user_id, Notification.entity_type == svc.CONTRACT_ENTITY,
        Notification.entity_id == contract_id, Notification.notification_type == ntype,
        func.date(Notification.created_at) == today,
    ).first() is not None


def _recipients(db: Session, c: ServiceContract) -> list[int]:
    from app.modules.organization.services.approval_engine import permission_holders
    ids = [c.created_by_id] if c.created_by_id else []
    try:
        ids += permission_holders(db, "erp:service_contracts:edit")
    except Exception:  # noqa: BLE001
        pass
    return list(dict.fromkeys(i for i in ids if i))


def run_contract_jobs(db: Session, today: date | None = None) -> dict:
    today = today or date.today()
    stats = {"expired": svc.expire_due(db, today), "reminders": 0, "invoiced": 0, "billing_failed": 0}
    db.commit()

    for c in db.query(ServiceContract).filter(ServiceContract.status == "active", ServiceContract.is_deleted == False).all():  # noqa: E712
        days = (c.end_date - today).days
        if days not in svc.REMINDER_DAYS:
            continue
        renewed = db.query(ServiceContract.id).filter(ServiceContract.renewed_from_id == c.id, ServiceContract.is_deleted == False,  # noqa: E712
                                                      ServiceContract.status != "cancelled").first()
        if renewed:
            continue
        cust = c.customer.name if c.customer else "the customer"
        sent_any, recipients = False, _recipients(db, c)
        for uid in recipients:
            if _sent_today(db, uid, c.id, EXPIRING, today):
                continue
            notify_user(db, user_id=uid, title=f"Contract {c.contract_number} ends in {days} days",
                        message=f"{svc.label(c)} with {cust} ends on {c.end_date:%d-%m-%Y}. Renew it (Service › Service Contracts › Renew) "
                                "so the machines stay covered.",
                        notification_type=EXPIRING, entity_type=svc.CONTRACT_ENTITY, entity_id=c.id, teams=True)
            stats["reminders"] += 1
            sent_any = True
        if sent_any:  # first run today for this contract → the subscribed roles too (bell / Teams; no email from a job)
            role_event(db, None, "contract_expiring", title=f"Contract {c.contract_number} ends in {days} days",
                       message=f"{svc.label(c)} with {cust} ends on {c.end_date:%d-%m-%Y}. Renew it (Service › Service Contracts › Renew) "
                               "so the machines stay covered.",
                       entity_type=svc.CONTRACT_ENTITY, entity_id=c.id, actor=None, skip_user_ids=set(recipients))
    db.commit()

    due = (db.query(ServiceContractBilling).join(ServiceContract, ServiceContract.id == ServiceContractBilling.contract_id)
           .filter(ServiceContract.status == "active", ServiceContract.is_deleted == False,  # noqa: E712
                   ServiceContractBilling.status == "planned", ServiceContractBilling.ar_transaction_id.is_(None),
                   ServiceContractBilling.due_date <= today)
           .order_by(ServiceContractBilling.due_date).all())
    for b in due:
        c = b.contract
        try:
            svc.invoice_line(db, c, b, None, invoice_date=today)
            db.commit()
            stats["invoiced"] += 1
        except Exception as e:  # noqa: BLE001 — one bad contract never stops the others
            db.rollback()
            stats["billing_failed"] += 1
            reason = getattr(e, "detail", None) or str(e)
            if c.created_by_id and not _sent_today(db, c.created_by_id, c.id, BILLING_FAILED, today):
                notify_user(db, user_id=c.created_by_id, title=f"Couldn't bill {c.contract_number}",
                            message=f"Period {b.sequence} ({b.period_start:%d-%m-%Y} to {b.period_end:%d-%m-%Y}) fell due but its invoice "
                                    f"couldn't be drafted: {reason}",
                            notification_type=BILLING_FAILED, entity_type=svc.CONTRACT_ENTITY, entity_id=c.id)
                role_event(db, None, "contract_billing_failed", title=f"Couldn't bill {c.contract_number}",
                           message=f"Period {b.sequence} ({b.period_start:%d-%m-%Y} to {b.period_end:%d-%m-%Y}) fell due but its invoice "
                                   f"couldn't be drafted: {reason}",
                           entity_type=svc.CONTRACT_ENTITY, entity_id=c.id, actor=None, skip_user_ids={c.created_by_id})
                db.commit()
    logger.info("service contracts: %(expired)s expired, %(reminders)s reminders, %(invoiced)s invoiced, %(billing_failed)s failed", stats)
    return stats


def run_erp_contract_scheduler() -> None:
    db = SessionLocal()
    try:
        run_contract_jobs(db)
    except Exception:
        logger.exception("Service contract scheduler failed")
        db.rollback()
    finally:
        db.close()
