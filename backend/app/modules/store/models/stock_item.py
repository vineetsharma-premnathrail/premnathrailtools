from __future__ import annotations
from sqlalchemy import String, Integer, Float, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Part catalog — deliberately separate from P2PRequestItem (a per-request free-text
# line, not a catalog entry). See docs/product/STORE_DEPARTMENT_MODULE_PLAN.md Phase 1.
STOCK_ITEM_STATUSES = ("active", "obsolete")


class StockItem(Base, TimestampMixin):
    __tablename__ = "stock_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    part_code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    item_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    make: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    purchase_uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    item_specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    manufacturer_part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    make_or_buy: Mapped[str | None] = mapped_column(String(10), nullable=True)
    default_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    reorder_point: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    reorder_quantity: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    minimum_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    maximum_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    standard_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    hsn_sac: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gst_tax: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quality_inspection_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    batch_serial_tracking: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
