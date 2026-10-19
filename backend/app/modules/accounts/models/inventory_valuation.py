from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money, Quantity, Rate

INVENTORY_VALUATION_STATUSES = ("draft", "posted", "cancelled")
# Where a line's rate came from — moving average is the default (AS-2 allows
# weighted average); standard cost when no receipt has set an average yet;
# manual when Finance overrides after a physical count.
RATE_SOURCES = ("moving_average", "standard", "manual", "none")
# "stock" = Store on-hand/quarantine; "wip" = cost sitting in an open
# Production work order at the valuation date (KKAX — see
# app/modules/production/costing.py wip_snapshot), rate_source "order_actual".
LINE_KINDS = ("stock", "wip")


class InventoryValuation(Base, TimestampMixin):
    """Periodic inventory: the closing-stock figure for one period end.

    Built as a draft from Store's on-hand quantities (Finance may correct
    quantities/rates after a physical count), then posted as
        Dr Stock-in-Hand (Balance Sheet)  /  Cr Changes in Inventories (P&L)
    dated valuation_date, with the reversal auto-posted on the next day so
    that figure becomes the next period's opening stock. P&L then shows
    Opening stock + Purchases - Closing stock without anyone posting it by hand."""

    __tablename__ = "inventory_valuations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    accounting_period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    valuation_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_value: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    posted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    lines: Mapped[list["InventoryValuationLine"]] = relationship(
        "InventoryValuationLine", back_populates="valuation", cascade="all, delete-orphan",
    )


class InventoryValuationLine(Base, TimestampMixin):
    __tablename__ = "inventory_valuation_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inventory_valuation_id: Mapped[int] = mapped_column(Integer, ForeignKey("inventory_valuations.id"), nullable=False, index=True)
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True)
    item_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    item_name: Mapped[str] = mapped_column(String(300), nullable=False)
    category: Mapped[str | None] = mapped_column(String(150), nullable=True)
    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Quantity, nullable=False, default=0)
    rate: Mapped[float] = mapped_column(Rate, nullable=False, default=0)
    value: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    rate_source: Mapped[str] = mapped_column(String(20), nullable=False, default="moving_average")
    line_kind: Mapped[str] = mapped_column(String(10), nullable=False, default="stock", server_default="stock")
    work_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_work_orders.id"), nullable=True)

    valuation: Mapped["InventoryValuation"] = relationship("InventoryValuation", back_populates="lines")
