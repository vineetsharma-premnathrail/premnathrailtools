from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Why material goes back to the vendor (SAP movement 122 "return delivery").
P2P_RETURN_REASONS = {
    "quality_rejection": "Rejected in inspection",
    "damaged": "Damaged in transit / on receipt",
    "wrong_item": "Wrong item supplied",
    "excess": "Excess quantity supplied",
    "other": "Other",
}

# What is being returned from a GRN line:
#   accepted — material that was accepted into Free stock: it leaves the store
#              (return_out at the PO rate), the PO's received quantity drops
#              (the vendor owes a replacement), and a debit note is raised if
#              the vendor's invoice is already booked;
#   rejected — material rejected in inspection: it was never taken into stock
#              (or Quality's NCR moved it), so this is the gate-pass record.
P2P_RETURN_SOURCES = ("accepted", "rejected")


class P2PVendorReturn(Base, TimestampMixin):
    """Return to Vendor (RTV) — goods sent back against a GRN. Posted when
    saved: stock leaves the store immediately and the document is the record
    (gate pass) of what went back, why, and the debit note raised for it."""

    __tablename__ = "p2p_vendor_returns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rtv_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("p2p_purchase_orders.id"), nullable=False, index=True)
    goods_receipt_id: Mapped[int] = mapped_column(ForeignKey("p2p_goods_receipts.id"), nullable=False, index=True)
    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    store_location_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    return_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Transport details for the gate pass.
    vehicle_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Raised from a Quality NCR's "return to vendor" disposition — the NCR
    # already moved the Blocked stock out, so this record posts no stock.
    ncr_id: Mapped[int | None] = mapped_column(ForeignKey("quality_ncrs.id"), nullable=True)
    stock_posted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Pending debit note created for Finance when the returned goods were
    # already invoiced; debit_note_message explains why none was raised.
    debit_note_id: Mapped[int | None] = mapped_column(ForeignKey("accounts_party_notes.id"), nullable=True)
    debit_note_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    items: Mapped[list["P2PVendorReturnItem"]] = relationship(
        "P2PVendorReturnItem", back_populates="vendor_return", cascade="all, delete-orphan"
    )


class P2PVendorReturnItem(Base, TimestampMixin):
    __tablename__ = "p2p_vendor_return_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_return_id: Mapped[int] = mapped_column(ForeignKey("p2p_vendor_returns.id"), nullable=False, index=True)
    grn_item_id: Mapped[int] = mapped_column(ForeignKey("p2p_goods_receipt_items.id"), nullable=False, index=True)
    store_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_items.id"), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # accepted | rejected
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    # PO line price (excl. GST) and GST % — the value the stock leaves at and
    # the debit note is raised at.
    unit_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    tax_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)

    vendor_return: Mapped["P2PVendorReturn"] = relationship("P2PVendorReturn", back_populates="items")
