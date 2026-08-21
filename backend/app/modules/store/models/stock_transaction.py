from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, ForeignKey, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

# Every stock movement in the system, from any department, is one row here —
# this table is Store's entire reason to exist. `quantity` is signed:
# positive for receipt/transfer_in/return, negative for issue/transfer_out;
# adjustment can be either sign depending on the counted variance.
STOCK_TRANSACTION_TYPES = ("receipt", "issue", "transfer_in", "transfer_out", "adjustment", "return")


class StockTransaction(Base):
    __tablename__ = "stock_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stock_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("stock_items.id"), nullable=False)
    location_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    performed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
