from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin


# Two-step stock transfer (transfer order → goods issue → goods receipt):
#   pending_approval  raised, nothing moved; waits on the central approval
#                     engine (workflow "store.stock_transfer")
#   approved          cleared to move; the sending store dispatches it
#   in_transit        dispatched — stock left the source store (transfer_out),
#                     the Stock Transfer Note travels with the material
#   received          the destination store confirmed receipt (transfer_in)
#   rejected / cancelled  closed without moving stock
# Transfers made before approvals existed moved stock at once → "received".
STOCK_TRANSFER_STATUSES = ("pending_approval", "approved", "in_transit", "received", "rejected", "cancelled")


class StoreStockTransfer(Base, TimestampMixin):
    """Movement of stock between two stores. Approved first, then the sending
    store dispatches it (transfer_out per line — the stock is in transit and
    on neither store's balance) and the receiving store confirms receipt
    (transfer_in per line, at the value it left with)."""

    __tablename__ = "store_stock_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transfer_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    from_location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)
    to_location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)

    transfer_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    transferred_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)  # raised by
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending_approval", server_default="received", nullable=False)

    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Dispatch — printed on the Stock Transfer Note that goes with the material.
    dispatched_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    vehicle_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    transporter_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    driver_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    driver_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    eway_bill_number: Mapped[str | None] = mapped_column(String(30), nullable=True)

    received_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    receipt_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    # GST on stock transport between plants (set at dispatch):
    #   delivery_challan  same GSTIN (Rule 55 challan, no tax)
    #   tax_invoice       different GSTINs = distinct persons (CGST Act Sch. I
    #                     para 2) — taxable at the transfer value, IGST when
    #                     the states differ, CGST + SGST otherwise.
    document_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    inter_state: Mapped[bool] = mapped_column(default=False, server_default="false", nullable=False)
    tax_invoice_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    from_gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    to_gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    taxable_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    cgst_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    sgst_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    igst_amount: Mapped[float | None] = mapped_column(Float, nullable=True)

    items: Mapped[list["StoreStockTransferItem"]] = relationship(
        "StoreStockTransferItem", back_populates="transfer", cascade="all, delete-orphan"
    )


class StoreStockTransferItem(Base, TimestampMixin):
    __tablename__ = "store_stock_transfer_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transfer_id: Mapped[int] = mapped_column(ForeignKey("store_stock_transfers.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Value of the transfer_out row (valuation on) — the receipt posts the
    # transfer_in at exactly this value, so the item's average doesn't drift.
    dispatch_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Tax invoice transfers only: transfer price per unit (default = average
    # cost), GST rate from the Item Master, taxable value and GST of the line.
    transfer_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    gst_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    taxable_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    tax_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    # WM: picked from from_bin_id at the sending store, put away to to_bin_id
    # (chosen on receipt) at the receiving store; serialised: the units moved.
    from_bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)
    to_bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)
    serial_numbers: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    transfer: Mapped["StoreStockTransfer"] = relationship("StoreStockTransfer", back_populates="items")
