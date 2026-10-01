"""Daily reminder notifications for overdue Purchase Orders.

Runs once a day (wired up in app/main.py) and notifies the buyer assigned to
the PO's originating PR — falling back to the PO's own creator for an ad-hoc
PO raised with no linked PR — for every PO whose vendor-promised
expected_delivery has passed with no goods receipt yet (status still
issued/acknowledged/partially_fulfilled, not fulfilled/cancelled/draft).
Fires again every day it remains overdue, same dedup-per-day shape as
app/tasks/followup_reminders.py."""
import asyncio
import logging
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.db.session import SessionLocal
from app.modules.main.models.user import User
from app.modules.main.models.notification import Notification
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.utils.notifications import notify_user
from app.utils.email import send_po_overdue_email

logger = logging.getLogger(__name__)

OVERDUE = "po_overdue"
_OVERDUE_STATUSES = ("issued", "acknowledged", "partially_fulfilled")


def _resolve_buyer_id(po: P2PPurchaseOrder) -> int | None:
    if po.p2p_request_id and po.p2p_request:
        return po.p2p_request.assigned_buyer_id or po.created_by_id
    return po.created_by_id


def _already_sent_today(db: Session, user_id: int, po_id: int) -> bool:
    return db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.entity_type == "p2p_purchase_order",
        Notification.entity_id == po_id,
        Notification.notification_type == OVERDUE,
        func.date(Notification.created_at) == date.today(),
    ).first() is not None


def _send_po_overdue_reminders(db: Session) -> None:
    """Pure logic over an already-open session — kept separate from session
    management so tests can call this directly against an isolated test DB."""
    today = date.today()
    pos = db.query(P2PPurchaseOrder).options(
        selectinload(P2PPurchaseOrder.p2p_request)
    ).filter(
        P2PPurchaseOrder.status.in_(_OVERDUE_STATUSES),
        P2PPurchaseOrder.expected_delivery.is_not(None),
        P2PPurchaseOrder.expected_delivery < today,
    ).all()

    for po in pos:
        buyer_id = _resolve_buyer_id(po)
        if not buyer_id or _already_sent_today(db, buyer_id, po.id):
            continue

        days_overdue = (today - po.expected_delivery).days
        day_word = "day" if days_overdue == 1 else "days"
        notify_user(
            db, user_id=buyer_id,
            title="Purchase Order Overdue",
            message=f"PO '{po.po_number}' ({po.vendor_name or 'vendor not set'}) was due {po.expected_delivery.isoformat()} — {days_overdue} {day_word} overdue.",
            notification_type=OVERDUE, entity_type="p2p_purchase_order", entity_id=po.id,
            teams=True,
        )

        buyer = db.query(User).filter(User.id == buyer_id).first()
        if buyer and buyer.email:
            try:
                asyncio.run(send_po_overdue_email(db, po, buyer, days_overdue))
            except Exception:
                logger.exception("Failed to send PO overdue email for PO %s", po.po_number)

    db.commit()


def send_po_overdue_reminders() -> None:
    """Scheduler entry point (see app/main.py) — opens its own DB session
    since it runs outside any request context."""
    db = SessionLocal()
    try:
        _send_po_overdue_reminders(db)
    except Exception:
        db.rollback()
        logger.exception("Failed to send PO overdue reminders")
    finally:
        db.close()
