from __future__ import annotations
from sqlalchemy import Integer, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Always derived/recomputed from stock_transactions — never hand-edited.
# The transaction log is the source of truth; this is a materialized cache
# for fast reads. See docs/product/STORE_DEPARTMENT_MODULE_PLAN.md.


class StockBalance(Base, TimestampMixin):
    __tablename__ = "stock_balances"
    __table_args__ = (UniqueConstraint("stock_item_id", "location_id", name="uq_stock_balance_item_location"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stock_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("stock_items.id"), nullable=False)
    location_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=False)
    quantity_on_hand: Mapped[float] = mapped_column(Float, default=0, nullable=False)
