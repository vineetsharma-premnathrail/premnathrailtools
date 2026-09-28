from __future__ import annotations
from sqlalchemy import String, Integer, Text, Float, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# What the item is used for — drives which downstream doc types (Purchase,
# Manufacturing BOM) it can be picked into. Free text, not an enum column in
# the DB (see item_type below) — kept as a suggested set for the frontend.
STORE_ITEM_TYPES = ("raw_material", "consumable", "spare_part", "finished_good", "semi_finished", "asset", "other")

STORE_ITEM_STATUSES = ("active", "inactive", "discontinued")


class StoreItem(Base, TimestampMixin):
    """Item Master. category/subcategory are free-text (not FK'd to
    StoreItemCategory) — matches the existing store_items table, which
    predates the StoreItemCategory master added alongside this model."""

    __tablename__ = "store_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    item_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    subcategory: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    secondary_uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    conversion_factor: Mapped[float | None] = mapped_column(Float, nullable=True)

    manufacturer: Mapped[str | None] = mapped_column(String(150), nullable=True)
    manufacturer_part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hsn_sac_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    material_grade: Mapped[str | None] = mapped_column(String(100), nullable=True)
    specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    make: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)

    batch_controlled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    serial_controlled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expiry_controlled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    shelf_life_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    minimum_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    maximum_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    reorder_level: Mapped[float | None] = mapped_column(Float, nullable=True)
    safety_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    reorder_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    standard_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    moving_average_cost: Mapped[float | None] = mapped_column(Float, nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    plant: Mapped[str | None] = mapped_column(String(100), nullable=True)
    preferred_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    preferred_supplier: Mapped[str | None] = mapped_column(String(150), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
