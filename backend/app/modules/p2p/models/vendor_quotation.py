from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.rfq import RFQ

# pending: not yet evaluated. qualified/disqualified: technical reviewer's
# call (only meaningful when the parent RFQ has requires_technical_evaluation).
VENDOR_QUOTATION_TECHNICAL_STATUSES = ("pending", "qualified", "disqualified")

# pending: not yet evaluated. approved/rejected: commercial reviewer's call.
VENDOR_QUOTATION_COMMERCIAL_STATUSES = ("pending", "approved", "rejected")


class VendorQuotation(Base, TimestampMixin):
    """A single vendor's structured quotation recorded against an RFQ —
    the price/terms data extracted from the raw quotation documents held as
    RFQAttachment (L1-L4) files. Multiple vendors quote against one RFQ;
    they're compared (read-only, no stored status of its own — just a query
    over these rows, see routes/rfq.py list_vendor_quotations), then run
    through Technical Evaluation (only if the RFQ requires it) and
    Commercial Evaluation, and finally one is marked is_selected=True — see
    routes/rfq.py select_vendor_quotation."""

    __tablename__ = "p2p_vendor_quotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rfq_id: Mapped[int] = mapped_column(Integer, ForeignKey("rfqs.id"), nullable=False)
    p2p_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=False)

    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)

    quoted_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_time: Mapped[str | None] = mapped_column(String(100), nullable=True)
    payment_terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    technical_status: Mapped[str] = mapped_column(String(15), default="pending", nullable=False)
    technical_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    technical_evaluated_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    technical_evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    commercial_status: Mapped[str] = mapped_column(String(15), default="pending", nullable=False)
    commercial_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    commercial_evaluated_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    commercial_evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    is_selected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    submitted_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    rfq: Mapped["RFQ"] = relationship("RFQ", back_populates="vendor_quotations")
