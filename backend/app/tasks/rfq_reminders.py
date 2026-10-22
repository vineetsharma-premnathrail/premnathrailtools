"""Daily RFQ follow-up (emailed RFQs, 2026-10-22).

- The day before an RFQ's quote-by date, re-send it as a reminder to every
  emailed vendor who hasn't quoted yet (once per vendor).
- The day after the quote-by date, tell the buyer how many quotes came in so
  they can open the comparison (once per RFQ).
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
from app.modules.p2p.models.vendor_quotation import VendorQuotation
from app.modules.p2p.settings import get_setting
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)

DUE_PASSED = "rfq_quotes_due"
# Quoting still matters only while the PR is in these stages.
_OPEN_PR = ("vendor_quotations", "technical_evaluation", "commercial_evaluation")


def _open_rfqs(db: Session, due: date) -> list[RFQ]:
    return (db.query(RFQ).join(P2PRequest, P2PRequest.id == RFQ.p2p_request_id)
            .filter(RFQ.status == "locked", RFQ.quote_due_date == due, P2PRequest.status.in_(_OPEN_PR)).all())


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
        if not rfq.created_by_id:
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
            db, user_id=rfq.created_by_id, title=f"RFQ {rfq.rfq_number}: quote-by date passed",
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
