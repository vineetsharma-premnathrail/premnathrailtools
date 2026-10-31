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

    # ME47 (2026-10-14): the quote's own reference, validity and the
    # header-level freight / packing charges, spread over its lines by value
    # in the ME49 comparison (p2p/quotation_compare.py).
    quote_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    freight_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    packing_total: Mapped[float | None] = mapped_column(Float, nullable=True)

    rfq: Mapped["RFQ"] = relationship("RFQ", back_populates="vendor_quotations")
    items: Mapped[list["VendorQuotationItem"]] = relationship(
        "VendorQuotationItem", back_populates="vendor_quotation", cascade="all, delete-orphan",
        order_by="VendorQuotationItem.id",
    )


class VendorQuotationItem(Base, TimestampMixin):
    """ME47 quotation line: one vendor's price for one PR line. The ME49
    comparison ranks vendors per line by landed unit cost (price after
    discount + the line's share of freight/packing; GST shown, not ranked —
    it is recoverable input credit). `is_awarded` is the buyer's line-level
    vendor choice that the ME21N split turns into one PO per vendor; awarding
    a line to anyone but the line's L1 needs `award_reason`."""

    __tablename__ = "p2p_vendor_quotation_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_quotation_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("p2p_vendor_quotations.id", ondelete="CASCADE"), nullable=False, index=True)
    pr_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_request_items.id"), nullable=False, index=True)
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True, index=True)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False)
    discount_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    gst_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    make_offered: Mapped[str | None] = mapped_column(String(150), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    is_awarded: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # Qty awarded to this vendor on this line (several vendors can split one line).
    # is_awarded is kept equal to (awarded_qty > 0). NULL = never awarded.
    awarded_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    award_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    awarded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    awarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    vendor_quotation: Mapped["VendorQuotation"] = relationship("VendorQuotation", back_populates="items")
