from __future__ import annotations
from sqlalchemy import Integer, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class StoreStockBalance(Base, TimestampMixin):
    """One row per (item, location) — kept current by
    app.modules.store.service.post_stock_transaction as the source of truth
    for "current stock". available = on_hand_qty - reserved_qty is computed,
    not stored."""

    __tablename__ = "store_stock_balances"
    __table_args__ = (UniqueConstraint("item_id", "location_id", name="uq_store_stock_balance_item_location"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False, index=True)

    on_hand_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    reserved_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # Damaged/rejected returned material physically in the store but NOT
    # usable — kept out of on_hand_qty (so it can't be issued/reserved)
    # until cleared via quarantine_out (scrap, vendor return, or release).
    quarantine_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
