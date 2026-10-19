"""Foreign currency: currency master, exchange rates by date, and the
month-end revaluation of open foreign-currency items (SAP OB08 / F.05).

Books are kept in INR (the company code currency). A foreign document keeps
its document currency, the rate it was booked at and its amount in that
currency; every journal line is in INR. Realised exchange differences are
posted when a foreign bill is settled (services/fx.py); unrealised ones by
the month-end revaluation, which reverses itself on the 1st of next month."""
from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Boolean, Date, Text, ForeignKey, JSON, Numeric, UniqueConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

BOOKS_CURRENCY = "INR"
# bank   — the bank's TT rate, used for payments, receipts and revaluation
# customs — the CBIC notified rate, used to value imports / exports (BOE, SB)
RATE_TYPES = ("bank", "customs")
FX_REVALUATION_STATUSES = ("posted", "reversed")

# Exchange rates are kept to 6 decimals (e.g. 1 JPY = 0.561234 INR).
FxRate = Numeric(18, 6, asdecimal=False)


class Currency(Base, TimestampMixin):
    __tablename__ = "accounts_currencies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(3), unique=True, nullable=False)  # ISO 4217
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    symbol: Mapped[str | None] = mapped_column(String(8), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ExchangeRate(Base, TimestampMixin):
    """1 unit of `currency` = `rate` INR, from `rate_date` until the next
    rate of the same type."""

    __tablename__ = "accounts_exchange_rates"
    __table_args__ = (UniqueConstraint("currency", "rate_date", "rate_type", name="uq_exchange_rate_currency_date_type"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, index=True)
    rate_date: Mapped[date] = mapped_column(Date, nullable=False)
    rate_type: Mapped[str] = mapped_column(String(10), nullable=False, default="bank")
    rate: Mapped[float] = mapped_column(FxRate, nullable=False)
    source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class FxRevaluation(Base, TimestampMixin):
    """One month-end revaluation (F.05). Its journal is posted on the last
    day of the month with auto-reversal on the 1st of the next, so the
    original booking rate stays the basis for realised gain/loss. `lines`
    snapshots every open item revalued: [{doc_type, doc_id, number, party,
    currency, open_fc, book_inr, rate, revalued_inr, difference}]."""

    __tablename__ = "accounts_fx_revaluations"
    __table_args__ = (
        Index("uq_fx_revaluation_one_posted_per_period", "accounting_period", unique=True,
              postgresql_where=text("status = 'posted'"), sqlite_where=text("status = 'posted'")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    accounting_period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    revaluation_date: Mapped[date] = mapped_column(Date, nullable=False)
    rates: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    lines: Mapped[list | None] = mapped_column(JSON, nullable=True)
    total_gain: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    total_loss: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted")
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
