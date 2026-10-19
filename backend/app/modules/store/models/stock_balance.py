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
    #
    # Stock types (Quality module): on_hand_qty is FREE stock (usable —
    # the only bucket issue / transfer / reservation / dispatch can draw on),
    # quality_qty is QUALITY stock (received, waiting for an inspection lot's
    # usage decision), quarantine_qty is BLOCKED stock (rejected / damaged —
    # waiting for an NCR disposition). Moves between the three go through
    # post_stock_transaction's quality_* / blocked_* types.
    quarantine_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    quality_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    # WITH VENDOR stock (SAP special stock O): material sent out on a job-work
    # challan. Still ours and still valued, but physically at the vendor —
    # never issuable. Moves only through the jobwork_* transaction types.
    vendor_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
