"""Daily RFQ follow-up (emailed RFQs, 2026-10-22).

- The day before an RFQ's quote-by date, re-send it as a reminder to every
  emailed vendor who hasn't quoted yet (once per vendor).
- The day after the quote-by date, tell the RFQ's own buyer (rfq.buyer_id; the user who started
  it for an old RFQ) how many quotes came in so they can open the comparison (once per RFQ).
Only RFQs that still have work: submitted, on a requisition still being bought, with at least one
active line that has something left to order (a requisition carries one RFQ per buyer, and a
buyer's RFQ whose lines all moved to another buyer or went to POs is not chased).
Switched off by Procurement › Settings › "Remind vendors a day before …"."""
import asyncio
import logging
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.modules.main.models.notification import Notification
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_invite import RFQVendorInvite
from app.modules.p2p.models.rfq_item import RFQItem
from app.modules.p2p.models.vendor_quotation import VendorQuotation
from app.modules.p2p.settings import get_setting
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)

DUE_PASSED = "rfq_quotes_due"


def _has_open_line(db: Session, rfq: RFQ, pr: P2PRequest) -> bool:
    """True when an active RFQ line still has quantity left to order."""
    from app.modules.p2p import line_progress

    active = {i.pr_item_id for i in db.query(RFQItem).filter(RFQItem.rfq_id == rfq.id, RFQItem.withdrawn_at.is_(None)).all()}
    if not active:
        return False
    progress = line_progress.line_progress(db, pr)
    return any(pid in progress and progress[pid].open_to_order > 1e-6 for pid in active)


def _open_rfqs(db: Session, due: date) -> list[RFQ]:
    """Submitted RFQs due on `due` whose requisition is still being bought and that have an open line."""
    from app.modules.p2p.po_split import PROCUREMENT_OPEN_STATUSES

    rows = (db.query(RFQ, P2PRequest).join(P2PRequest, P2PRequest.id == RFQ.p2p_request_id)
            .filter(RFQ.status == "locked", RFQ.quote_due_date == due, P2PRequest.status.in_(PROCUREMENT_OPEN_STATUSES)).all())
    return [rfq for rfq, pr in rows if _has_open_line(db, rfq, pr)]


def _send_rfq_reminders(db: Session) -> None:
    if not get_setting(db, "rfq_auto_reminder"):
        return
    from app.modules.p2p.routes.rfq_invites import send_invites

    today = date.today()
    for rfq in _open_rfqs(db, today + timedelta(days=1)):
        quoted = {vq.vendor_id for vq in db.query(VendorQuotation).filter(VendorQuotation.rfq_id == rfq.id).all()}
        waiting = db.query(RFQVendorInvite).filter(
            RFQVendorInvite.rfq_id == rfq.id, RFQVendorInvite.email_status == "sent",
            RFQVendorInvite.reminder_sent_at.is_(None),
        ).all()
        waiting = [i for i in waiting if i.vendor_id not in quoted]
        if waiting:
            try:
                asyncio.run(send_invites(db, rfq, waiting, None, reminder=True))
            except Exception:
                db.rollback()
                logger.exception("RFQ reminder emails failed for %s", rfq.rfq_number)

    for rfq in _open_rfqs(db, today - timedelta(days=1)):
        buyer_id = rfq.buyer_id or rfq.created_by_id
        if not buyer_id:
            continue
        invited = db.query(RFQVendorInvite).filter(RFQVendorInvite.rfq_id == rfq.id).count()
        if not invited:
            continue
        already = db.query(Notification).filter(
            Notification.notification_type == DUE_PASSED, Notification.entity_type == "rfq", Notification.entity_id == rfq.id,
        ).first()
        if already:
            continue
        got = db.query(VendorQuotation).filter(VendorQuotation.rfq_id == rfq.id).count()
        notify_user(
            db, user_id=buyer_id, title=f"RFQ {rfq.rfq_number}: quote-by date passed",
            message=f"{got} of {invited} vendors quoted on {rfq.rfq_number}. Record any quotes still in your mailbox, "
                    "then open the comparison to award L1.",
            notification_type=DUE_PASSED, entity_type="rfq", entity_id=rfq.id, teams=True,
        )
    db.commit()


def send_rfq_reminders() -> None:
    """Scheduler entry point (see app/main.py)."""
    db = SessionLocal()
    try:
        _send_rfq_reminders(db)
    except Exception:
        db.rollback()
        logger.exception("Failed to run RFQ reminders")
    finally:
        db.close()
