from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Email delivery of the RFQ to this vendor. Whether the vendor has quoted is
# not stored here — it is "a line quotation exists for this vendor on the
# RFQ" (routes/rfq_invites.py), so recording / replacing a quote needs no sync.
RFQ_INVITE_EMAIL_STATUSES = ("pending", "sent", "failed")


class RFQVendorInvite(Base, TimestampMixin):
    """A vendor invited to quote on an RFQ by email (2026-10-22). The buyer
    picks vendors from the master; on submit the system emails each one the
    items, quantities, quote-by date and late delivery clause. Vendors reply
    by email and the buyer records the reply as a line quotation (ME47);
    the comparison (ME49) then ranks L1, L2, L3 … by landed cost."""

    __tablename__ = "rfq_vendor_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rfq_id: Mapped[int] = mapped_column(Integer, ForeignKey("rfqs.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=False, index=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # The address the RFQ went to (the vendor master's contact email at send time).
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    email_status: Mapped[str] = mapped_column(String(10), default="pending", nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    send_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
