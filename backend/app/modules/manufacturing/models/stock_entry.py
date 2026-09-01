from __future__ import annotations
from sqlalchemy import String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

STOCK_ENTRY_TYPES = {"receipt", "issue", "adjustment"}


class StockEntry(Base, TimestampMixin):
    """A single material movement — `receipt` (material in), `issue`
    (material consumed, typically against a Work Order), or `adjustment`
    (manual correction, quantity can be negative)."""

    __tablename__ = "manufacturing_stock_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_materials.id"), nullable=False)
    work_order_id: Mapped[int | None] = mapped_column(ForeignKey("manufacturing_work_orders.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
