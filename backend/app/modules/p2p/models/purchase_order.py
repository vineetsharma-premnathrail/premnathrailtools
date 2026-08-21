from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.vendor.models.vendor import Vendor

# draft -> issued -> acknowledged -> partially_fulfilled -> fulfilled
#      \-> cancelled (from any state before fulfilled)
P2P_PO_STATUSES = ("draft", "issued", "acknowledged", "partially_fulfilled", "fulfilled", "cancelled")


class P2PPurchaseOrder(Base, TimestampMixin):
    """A formal Purchase Order, optionally raised against a P2PRequest
    (p2p_request_id nullable — allows an ad-hoc PO raised directly, e.g. by
    Store for stock replenishment, without a prior request). See
    docs/product/PURCHASE_DEPARTMENT_MODULE_PLAN.md Phase 2."""

    __tablename__ = "p2p_purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    p2p_request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=True)
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[str] = mapped_column(String(30), default="draft", nullable=False)
    po_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_delivery: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivery_terms: Mapped[str | None] = mapped_column(Text, nullable=True)

    total_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    p2p_request: Mapped["P2PRequest | None"] = relationship("P2PRequest")
    vendor: Mapped["Vendor | None"] = relationship("Vendor")
    items: Mapped[list["P2PPurchaseOrderItem"]] = relationship(
        "P2PPurchaseOrderItem", back_populates="purchase_order", cascade="all, delete-orphan"
    )


class P2PPurchaseOrderItem(Base, TimestampMixin):
    __tablename__ = "p2p_purchase_order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=False)

    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    make: Mapped[str | None] = mapped_column(String(100), nullable=True)
    part_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1, nullable=False)
    unit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    tax_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    line_total: Mapped[float | None] = mapped_column(Float, nullable=True)

    purchase_order: Mapped["P2PPurchaseOrder"] = relationship("P2PPurchaseOrder", back_populates="items")
