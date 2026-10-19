"""Weighted-average stock valuation (Store foundation plan §3.1, §3.4, §4.1, §4.2).

One average per item for the whole company, maintained in posting order by
app.modules.store.services.valuation.apply_valuation() — called from
post_stock_transaction() while the Store setting `valuation_enabled` is on.

`value` is the source of truth; `avg_rate` is derived (value ÷ qty) and never
fed back into the arithmetic, so the total never drifts by paise."""
from __future__ import annotations

from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.store.models._types import Money, Quantity, Rate

# Value-only changes (no ledger row, because a ledger row needs quantity > 0).
STORE_VALUATION_EVENT_TYPES = (
    "cutover_opening",           # cut-over / backfill / first valued posting: sets qty + value per item
    "rounding_writeoff",         # qty reached 0 with a residual value (safety net)
    "revaluation",               # manual rate correction (Phase F) or a vendor-return clamp
    "wo_settlement",             # Production Phase 4 FG revaluation
    "invoice_price_difference",  # reserved, unused by default (§12 Q4)
    "landed_cost",               # delivery cost billed after receipt, loaded into stock on hand (p2p/landed_cost.py)
)

# Where a ledger row's unit_cost came from (store_stock_transactions.cost_source).
STORE_COST_SOURCES = (
    "po_rate", "average", "standard", "manual_rate", "opening", "issue_rate", "grn_rate",
    "provisional", "unpriced_po", "backfill", "none",
    "production_actual",  # FG receipt from a work order at its actual cost (production/costing.py)
    "job_work",  # processed item back from a job-work vendor: components consumed + job charge
    "landed",  # GRN at PO rate + planned delivery costs (freight / packing / insurance / customs duty)
)


class StoreItemValuation(Base, TimestampMixin):
    """Running company-wide quantity and value of one item. Not audited row by
    row — the ledger cost columns and store_valuation_events are the trail."""

    __tablename__ = "store_item_valuations"

    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), primary_key=True)
    # Σ on hand + quality + blocked over all stores (reserved is inside on hand).
    qty: Mapped[float] = mapped_column(Quantity, nullable=False, default=0, server_default="0")
    value: Mapped[float] = mapped_column(Money, nullable=False, default=0, server_default="0")
    # value ÷ qty while qty > 0; keeps the last rate when qty is 0.
    avg_rate: Mapped[float | None] = mapped_column(Rate, nullable=True)
    last_receipt_rate: Mapped[float | None] = mapped_column(Rate, nullable=True)
    last_receipt_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_receipt_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Quantity that came in with no rate at all (legacy / system receipts) — warning count.
    unvalued_qty: Mapped[float] = mapped_column(Quantity, nullable=False, default=0, server_default="0")


class StoreValuationEvent(Base, TimestampMixin):
    """A change in an item's value that moves no quantity. Audited."""

    __tablename__ = "store_valuation_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    value_delta: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    qty_basis: Mapped[float | None] = mapped_column(Quantity, nullable=True)
    rate_before: Mapped[float | None] = mapped_column(Rate, nullable=True)
    rate_after: Mapped[float | None] = mapped_column(Rate, nullable=True)
    reference_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reference_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
