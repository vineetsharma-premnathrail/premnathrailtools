from __future__ import annotations
from sqlalchemy import String, Integer, Float, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class BOM(Base, TimestampMixin):
    """Bill of Materials — a recipe for producing `output_material` in
    `output_quantity` units, consuming the component materials listed in
    BOMItem. Work Orders reference a BOM as the production plan to execute."""

    __tablename__ = "manufacturing_boms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    output_material_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_materials.id"), nullable=False)
    output_quantity: Mapped[float] = mapped_column(Float, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class BOMItem(Base, TimestampMixin):
    """One component line of a BOM — `quantity` of `material_id` consumed
    per `output_quantity` of the BOM's output material."""

    __tablename__ = "manufacturing_bom_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_boms.id"), nullable=False)
    material_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_materials.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
