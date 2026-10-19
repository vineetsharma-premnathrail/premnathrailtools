"""Delivery costs and landed cost (SAP ME21N delivery-cost conditions FRA1 /
FRB1 / ZOA1, MIRO unplanned delivery costs).

Only NON-CREDITABLE cost goes into stock value: freight, packing, insurance,
clearing and basic customs duty + SWS. The GST charged on these services
(and the IGST paid on an import) is input tax credit, so it is never loaded —
`gst_rate` is kept for reference only and `amount` is always the amount
before GST.

* P2PPOCharge — planned on the PO; every GRN of the PO is valued at
  PO rate + the charge apportioned to the line (by value or quantity).
* P2PLandedCostVoucher — a cost billed later (or one not planned on the PO):
  apportioned over what has been received, loaded into the stock still on
  hand as a value-only revaluation; the share already consumed is shown as
  consumption cost."""
from __future__ import annotations

from datetime import date

from sqlalchemy import Date, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin

P2P_CHARGE_TYPES = {
    "freight": "Freight",
    "packing": "Packing & forwarding",
    "insurance": "Transit insurance",
    "customs_duty": "Customs duty (BCD + SWS, non-creditable)",
    "clearing": "Clearing & handling",
    "other": "Other delivery cost",
}
P2P_CHARGE_BASES = {"value": "By line value", "quantity": "By quantity"}


class P2PPOCharge(Base, TimestampMixin):
    __tablename__ = "p2p_po_charges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("p2p_purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    charge_type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    basis: Mapped[str] = mapped_column(String(10), nullable=False, default="value", server_default="value")
    amount: Mapped[float] = mapped_column(Float, nullable=False)  # before GST
    gst_rate: Mapped[float | None] = mapped_column(Float, nullable=True)  # creditable — reference only
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id"), nullable=True)  # e.g. a separate transporter
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class P2PLandedCostVoucher(Base, TimestampMixin):
    __tablename__ = "p2p_landed_cost_vouchers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    voucher_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("p2p_purchase_orders.id"), nullable=False, index=True)
    voucher_date: Mapped[date] = mapped_column(Date, nullable=False)
    charge_type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    basis: Mapped[str] = mapped_column(String(10), nullable=False, default="value", server_default="value")
    amount: Mapped[float] = mapped_column(Float, nullable=False)  # before GST
    gst_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id"), nullable=True)
    bill_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    value_to_stock: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    value_to_consumption: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted", server_default="posted")
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    allocations: Mapped[list["P2PLandedCostAllocation"]] = relationship(
        "P2PLandedCostAllocation", back_populates="voucher", cascade="all, delete-orphan")


class P2PLandedCostAllocation(Base, TimestampMixin):
    __tablename__ = "p2p_landed_cost_allocations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    voucher_id: Mapped[int] = mapped_column(ForeignKey("p2p_landed_cost_vouchers.id", ondelete="CASCADE"), nullable=False, index=True)
    po_item_id: Mapped[int] = mapped_column(ForeignKey("p2p_purchase_order_items.id"), nullable=False)
    store_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_items.id"), nullable=True)
    basis_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    basis_value: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    allocated_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    to_stock: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    to_consumption: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    voucher: Mapped["P2PLandedCostVoucher"] = relationship("P2PLandedCostVoucher", back_populates="allocations")
