from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.p2p.models.order_project_mixin import OrderProjectLineMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

# draft: created, quantities recorded but not yet quality-inspected.
# completed: every item inspected (accepted/rejected split recorded) —
# terminal, rolls up into the PO's fulfilment status and the parent
# P2PRequest's legacy receipt_status/received_quantity fields (kept for
# backward-compat with the PR-level "partially_received"/"received"
# status gate that /close still checks).
# reversed: cancelled as a whole because it was entered wrongly (SAP 102) —
# its stock was taken back out and it no longer counts as received.
P2P_GRN_STATUSES = ("draft", "completed", "reversed")

# A line item's quality-inspection result. "pending" is the pre-inspection
# default; the frontend's inspection dropdown only ever submits one of the
# other three (see grn/[id]/page.tsx QUALITY_OPTIONS).
# "in_quality": the item is flagged inspection-on-receipt, so the line sits in
# QUALITY stock under a Quality inspection lot; the lot's usage decision sets
# passed/failed/partial and the accepted/rejected split.
P2P_GRN_QUALITY_STATUSES = ("pending", "passed", "failed", "partial", "in_quality")


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

    reversed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Gate entry + the vendor's documents that came with the goods (MIGO
    # header / Indian gate register): the vendor invoice no. is unique per
    # vendor across GRNs that aren't reversed (checked in the create route).
    gate_entry_number: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    gate_entry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    vendor_invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    vendor_invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivery_challan_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    delivery_challan_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    eway_bill_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    vehicle_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    transporter_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    lr_number: Mapped[str | None] = mapped_column(String(50), nullable=True)

    purchase_order: Mapped["P2PPurchaseOrder"] = relationship("P2PPurchaseOrder")
    items: Mapped[list["P2PGoodsReceiptItem"]] = relationship(
        "P2PGoodsReceiptItem", back_populates="goods_receipt", cascade="all, delete-orphan"
    )


class P2PGoodsReceiptItem(Base, TimestampMixin, OrderProjectLineMixin):
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
    # Item Master link copied from the PO line — the stock ledger posts against it.
    store_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_items.id"), nullable=True, index=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ordered_quantity: Mapped[float] = mapped_column(Float, nullable=False)

    received_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    # Blind receipt: what the vendor's invoice / challan SAYS was sent, kept
    # apart from received_quantity (what the store physically counted). The
    # difference is the receipt variance shown on the GRN.
    invoice_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    # WM putaway: the bin the goods were put into (store_bins of the GRN's store).
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)
    # Serialised item: the serial numbers received (store_serial_numbers holds their life).
    serial_numbers: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    accepted_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    rejected_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Sent back to the vendor on Return-to-Vendor documents. Accepted
    # quantity returned no longer counts as received (the vendor owes a
    # replacement); rejected quantity returned is just its gate-pass record.
    returned_quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    rejected_returned_quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")

    quality_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    # How this line reached the stock ledger (SAP 101):
    #   "quality" — received into QUALITY stock when the GRN was recorded; the
    #               GRN inspection then releases accepted to Free and moves
    #               rejected to Blocked (until it goes back to the vendor);
    #   "lot"     — a Quality inspection lot took it into QUALITY stock;
    #   "none"    — service / asset line: never store stock;
    #   NULL      — GRNs recorded before 2026-10-13: nothing posted at
    #               receipt, the accepted quantity is posted at inspection.
    receipt_posting: Mapped[str | None] = mapped_column(String(10), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    # PM project link (2026-10-17): the vehicle / lot of the build-to-order
    # project this line is bought for — copied from its PO line
    # so Store can tag the received stock (p2p/order_project_links.py).
    order_project_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pm_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    order_project_element_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pm_project_elements.id", ondelete="SET NULL"), nullable=True, index=True)

    goods_receipt: Mapped["P2PGoodsReceipt"] = relationship("P2PGoodsReceipt", back_populates="items")
    po_item: Mapped["P2PPurchaseOrderItem"] = relationship("P2PPurchaseOrderItem")
    store_item = relationship("StoreItem")
    order_project_element = relationship("PmProjectElement", viewonly=True, lazy="select")

    @property
    def item_code(self) -> str | None:
        return self.store_item.item_code if self.store_item is not None else None

    @property
    def receipt_variance(self) -> float | None:
        """Physically received − invoice / challan quantity (None when the
        invoice quantity wasn't entered). Negative = short supply."""
        if self.invoice_quantity is None:
            return None
        return round((self.received_quantity or 0) - self.invoice_quantity, 6)
