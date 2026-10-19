from __future__ import annotations
from datetime import date
from sqlalchemy import Boolean, Date, Float, String, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money


class VendorCatalogItem(Base, TimestampMixin):
    """One item a vendor sells, at what price, with its size / technical
    specification — typed in or imported from the vendor's sheet (Procurement →
    Vendors → Catalog). Used to pick vendors for an RFQ."""

    __tablename__ = "vendor_catalog_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    part_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    make: Mapped[str | None] = mapped_column(String(150), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    unit_price: Mapped[float | None] = mapped_column(Money, nullable=True)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="INR")
    dimensions: Mapped[str | None] = mapped_column(String(255), nullable=True)
    technical_spec: Mapped[str | None] = mapped_column(Text, nullable=True)
    lead_time_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # ME11 purchasing info record (2026-10-14): a catalog line linked to its
    # Item Master item IS the vendor + item info record — PO prices default
    # from it by (vendor_id, store_item_id), never by name. min_order_qty /
    # validity are the vendor's terms; last_po_* is upserted when a PO line
    # for this vendor + item is approved (p2p/info_records.py).
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True, index=True)
    min_order_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_po_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_po_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_po_price: Mapped[float | None] = mapped_column(Float, nullable=True)
