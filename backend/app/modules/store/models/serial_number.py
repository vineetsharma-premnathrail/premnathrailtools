from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Serial number management (SAP IQ01 / serial profile on GR and GI).
# One row per physical unit of a serialised item (StoreItem.serial_controlled
# — engines, pumps, gearboxes, PLCs). Captured on the GRN, followed through
# Quality / Free / Blocked stock, transfers and the issue to a work order,
# machine or service request; every change is a StoreSerialEvent row (the
# serial history), so warranty claims against the supplier and the machine's
# service history can name the exact unit.
#
#   quality      received on a GRN, waiting for the inspection (Quality stock)
#   in_stock     usable (Free stock) at location_id / bin_id
#   blocked      rejected / damaged — Blocked stock, can't be issued
#   in_transit   on a dispatched stock transfer, at neither store
#   issued       issued out of the store (issued_to says against what)
#   returned_to_vendor  sent back to the supplier on a Return to Vendor
#   cancelled    the GRN that brought it in was reversed (entered wrongly)
STORE_SERIAL_STATUSES = ("quality", "in_stock", "blocked", "in_transit", "issued", "returned_to_vendor", "cancelled")
STORE_SERIAL_STATUS_LABELS = {
    "quality": "In Quality stock", "in_stock": "In stock", "blocked": "Blocked", "in_transit": "In transit",
    "issued": "Issued", "returned_to_vendor": "Returned to vendor", "cancelled": "Cancelled (GRN reversed)",
}
# Statuses in which the unit is physically in one of our stores.
STORE_SERIAL_IN_STORE = ("quality", "in_stock", "blocked")


class StoreSerialNumber(Base, TimestampMixin):
    __tablename__ = "store_serial_numbers"
    __table_args__ = (UniqueConstraint("item_id", "serial_no", name="uq_store_serial_item_serial"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    serial_no: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="quality", index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True, index=True)
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Where it came from (the supplier warranty is claimed against this).
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    grn_id: Mapped[int | None] = mapped_column(ForeignKey("p2p_goods_receipts.id"), nullable=True, index=True)
    grn_item_id: Mapped[int | None] = mapped_column(ForeignKey("p2p_goods_receipt_items.id"), nullable=True, index=True)
    received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    vendor_warranty_until: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Where it went (latest issue).
    issue_id: Mapped[int | None] = mapped_column(ForeignKey("store_material_issues.id"), nullable=True, index=True)
    issue_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_material_issue_items.id"), nullable=True)
    issued_to: Mapped[str | None] = mapped_column(String(255), nullable=True)       # "Work order WO-12 · Machine …"
    work_order: Mapped[str | None] = mapped_column(String(150), nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(ForeignKey("erp_projects.id"), nullable=True, index=True)
    service_request_id: Mapped[int | None] = mapped_column(ForeignKey("erp_service_requests.id"), nullable=True, index=True)
    # On a stock transfer that is raised / dispatched but not yet received.
    transfer_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_stock_transfer_items.id"), nullable=True)

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class StoreSerialEvent(Base, TimestampMixin):
    """Serial history: one row per movement of one serialised unit."""

    __tablename__ = "store_serial_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    serial_id: Mapped[int] = mapped_column(ForeignKey("store_serial_numbers.id"), nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(30), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)
    reference_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reference_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
