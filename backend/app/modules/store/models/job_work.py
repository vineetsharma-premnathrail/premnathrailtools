from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.store.models._types import Money, Rate

# Job work / subcontracting (SAP item category L, ME2O, GST ITC-04).
#
# The CHALLAN is the Material Issue of type "job_work": its lines post
# jobwork_out (Free → With vendor), so the material stays on our books, valued,
# shown per vendor. Material comes back in one of two ways:
#   • the same item comes back (e.g. a casting machined) → Material Return
#     against the challan → jobwork_in / jobwork_to_quality (With vendor → Free / Quality);
#   • a different, processed item comes back (bar → machined shaft) → a Job
#     Work Receipt (this table): the components used are consumed out of
#     With-vendor stock (jobwork_consume) and the processed item(s) are received
#     at component value + the vendor's job charge. One receipt can bring back
#     several different items (one plate cut into a flange and a ring) — one
#     StoreJobWorkReceiptOutput row each; the component value is split over
#     them by cost share.
# GST Rule 45 / ITC-04: inputs must come back within 1 year (capital goods 3
# years) of the challan or GST becomes payable — tracked per challan line.


class StoreJobWorkReceipt(Base, TimestampMixin):
    __tablename__ = "store_job_work_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    issue_id: Mapped[int] = mapped_column(ForeignKey("store_material_issues.id"), nullable=False, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id"), nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    receipt_date: Mapped[date] = mapped_column(Date, nullable=False)
    # The vendor's own delivery challan / invoice for the processed goods.
    vendor_challan_number: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # First output line, kept on the header for older readers; the full list
    # is `outputs`.
    output_item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    output_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    output_batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Job charge per unit of the processed item (the service PO rate when a
    # PO line is linked), and the resulting valuation.
    purchase_order_id: Mapped[int | None] = mapped_column(ForeignKey("p2p_purchase_orders.id"), nullable=True)
    purchase_order_item_id: Mapped[int | None] = mapped_column(ForeignKey("p2p_purchase_order_items.id"), nullable=True)
    job_charge_rate: Mapped[float | None] = mapped_column(Rate, nullable=True)
    component_value: Mapped[float | None] = mapped_column(Money, nullable=True)
    output_unit_cost: Mapped[float | None] = mapped_column(Rate, nullable=True)
    # Job work inspection lot raised for the processed item, if any.
    inspection_lot_id: Mapped[int | None] = mapped_column(ForeignKey("quality_inspection_lots.id"), nullable=True)

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    components: Mapped[list["StoreJobWorkReceiptComponent"]] = relationship(
        "StoreJobWorkReceiptComponent", back_populates="receipt", cascade="all, delete-orphan",
        order_by="StoreJobWorkReceiptComponent.id",
    )
    outputs: Mapped[list["StoreJobWorkReceiptOutput"]] = relationship(
        "StoreJobWorkReceiptOutput", back_populates="receipt", cascade="all, delete-orphan",
        order_by="StoreJobWorkReceiptOutput.id",
    )


class StoreJobWorkReceiptOutput(Base, TimestampMixin):
    """One processed item received on the receipt. `cost_share_pct` is the
    share of the component value this item carries (entered, or worked out
    from the items' standard cost × quantity); unit cost = (share of
    component value + job charge × quantity) ÷ quantity."""

    __tablename__ = "store_job_work_receipt_outputs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("store_job_work_receipts.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    purchase_order_item_id: Mapped[int | None] = mapped_column(ForeignKey("p2p_purchase_order_items.id"), nullable=True)
    job_charge_rate: Mapped[float | None] = mapped_column(Rate, nullable=True)
    cost_share_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    component_value: Mapped[float | None] = mapped_column(Money, nullable=True)
    unit_cost: Mapped[float | None] = mapped_column(Rate, nullable=True)
    inspection_lot_id: Mapped[int | None] = mapped_column(ForeignKey("quality_inspection_lots.id"), nullable=True)

    receipt: Mapped["StoreJobWorkReceipt"] = relationship("StoreJobWorkReceipt", back_populates="outputs")


class StoreJobWorkReceiptComponent(Base, TimestampMixin):
    """One challan line's material used up at the vendor for this receipt:
    consumed into the processed item, plus any process scrap / loss the
    vendor keeps. Both leave With-vendor stock (jobwork_consume)."""

    __tablename__ = "store_job_work_receipt_components"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("store_job_work_receipts.id"), nullable=False, index=True)
    issue_item_id: Mapped[int] = mapped_column(ForeignKey("store_material_issue_items.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    consumed_quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    scrap_quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    value: Mapped[float | None] = mapped_column(Money, nullable=True)

    receipt: Mapped["StoreJobWorkReceipt"] = relationship("StoreJobWorkReceipt", back_populates="components")
