from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin


class StoreStockTransfer(Base, TimestampMixin):
    """Movement of stock between two warehouses — posts a paired
    transfer_out (at from_location) / transfer_in (at to_location)
    transaction per line as soon as it's created."""

    __tablename__ = "store_stock_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transfer_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    from_location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)
    to_location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)

    transfer_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    transferred_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["StoreStockTransferItem"]] = relationship(
        "StoreStockTransferItem", back_populates="transfer", cascade="all, delete-orphan"
    )


class StoreStockTransferItem(Base, TimestampMixin):
    __tablename__ = "store_stock_transfer_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transfer_id: Mapped[int] = mapped_column(ForeignKey("store_stock_transfers.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    transfer: Mapped["StoreStockTransfer"] = relationship("StoreStockTransfer", back_populates="items")
