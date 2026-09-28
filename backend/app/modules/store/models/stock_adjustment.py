from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin


class StoreStockAdjustment(Base, TimestampMixin):
    """A stock-count correction at one warehouse — posts an adjustment_in
    or adjustment_out transaction per line depending on the sign of
    (actual_quantity - existing_quantity). existing_quantity is read from
    the live balance server-side at creation time, not taken from the
    client, so it can't be spoofed to fabricate a difference."""

    __tablename__ = "store_stock_adjustments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    adjustment_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)

    adjustment_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["StoreStockAdjustmentItem"]] = relationship(
        "StoreStockAdjustmentItem", back_populates="adjustment", cascade="all, delete-orphan"
    )


class StoreStockAdjustmentItem(Base, TimestampMixin):
    __tablename__ = "store_stock_adjustment_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    adjustment_id: Mapped[int] = mapped_column(ForeignKey("store_stock_adjustments.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    existing_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    actual_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    difference: Mapped[float] = mapped_column(Float, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    adjustment: Mapped["StoreStockAdjustment"] = relationship("StoreStockAdjustment", back_populates="items")
