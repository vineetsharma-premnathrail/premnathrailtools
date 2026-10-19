from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

# draft -> accepted (counts as received for the PO and the 3-way match)
#      \-> cancelled (draft or accepted, with a reason, while not invoiced)
P2P_SERVICE_ENTRY_STATUSES = ("draft", "accepted", "cancelled")


class P2PServiceEntry(Base, TimestampMixin):
    """Service entry sheet (SAP ML81N) — how a service PO line (job work
    charges, AMC, calibration, consultancy) is "received". A service is never
    store stock: the person who got the service records what was done for
    which period, and accepting the entry is what counts as receipt for the
    PO status and for matching the vendor's invoice."""

    __tablename__ = "p2p_service_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ses_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    purchase_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=False, index=True)
    po_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_purchase_order_items.id"), nullable=False, index=True)

    period_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    accepted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    po_item = relationship("P2PPurchaseOrderItem")
