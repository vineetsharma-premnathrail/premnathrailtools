from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

# draft: created, quantities recorded but not yet quality-inspected.
# completed: every item inspected (accepted/rejected split recorded) —
# terminal, rolls up into the PO's fulfilment status and the parent
# P2PRequest's legacy receipt_status/received_quantity fields (kept for
# backward-compat with the PR-level "partially_received"/"received"
# status gate that /close still checks).
P2P_GRN_STATUSES = ("draft", "completed")


class P2PGoodsReceipt(Base, TimestampMixin):
    """A goods receipt note against one Purchase Order — the real,
    line-item-level replacement for the flat ordered/received_quantity
    fields that used to live directly on P2PRequest. A PO can have more
    than one GRN (partial deliveries), each with its own items."""

    __tablename__ = "p2p_goods_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    grn_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    purchase_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=False, index=True)

    # Where the goods physically landed — the closest this codebase gets to
    # an inventory system today, since app.modules.store has no stock ledger
    # yet (just a location master). Nullable: not every receipt is tied to
    # a Store location (e.g. site-direct delivery).
    store_location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    received_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    inspected_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    inspected_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    purchase_order: Mapped["P2PPurchaseOrder"] = relationship("P2PPurchaseOrder")
    items: Mapped[list["P2PGoodsReceiptItem"]] = relationship(
        "P2PGoodsReceiptItem", back_populates="goods_receipt", cascade="all, delete-orphan"
    )


class P2PGoodsReceiptItem(Base, TimestampMixin):
    """One PO line item's receipt + quality-inspection result. quality_status
    starts 'pending' at creation and is set by the inspection step; a line
    can be split accepted/rejected (e.g. 8 of 10 units passed inspection)."""

    __tablename__ = "p2p_goods_receipt_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    goods_receipt_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_goods_receipts.id"), nullable=False)
    po_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_purchase_order_items.id"), nullable=False)

    # Snapshot of the PO line at receipt time, so this record stays
    # meaningful even if the PO item is later edited (it shouldn't be, once
    # issued, but this avoids ever showing a receipt against different specs
    # than what was actually received).
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ordered_quantity: Mapped[float] = mapped_column(Float, nullable=False)

    received_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    accepted_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    rejected_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)

    quality_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    goods_receipt: Mapped["P2PGoodsReceipt"] = relationship("P2PGoodsReceipt", back_populates="items")
    po_item: Mapped["P2PPurchaseOrderItem"] = relationship("P2PPurchaseOrderItem")
