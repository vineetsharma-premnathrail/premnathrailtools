from __future__ import annotations
from sqlalchemy import String, Integer, Text, Numeric, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class Item(Base, TimestampMixin):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    item_group: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit_of_measure: Mapped[str | None] = mapped_column(String(20), nullable=True)
    purchase_uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    item_specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    manufacturer_part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    make_or_buy: Mapped[str | None] = mapped_column(String(10), nullable=True)
    default_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    minimum_stock: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    maximum_stock: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    hsn_sac: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gst_tax: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quality_inspection_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    batch_serial_tracking: Mapped[str | None] = mapped_column(String(20), nullable=True)
    item_status: Mapped[str] = mapped_column(String(20), default="Active", nullable=False)
