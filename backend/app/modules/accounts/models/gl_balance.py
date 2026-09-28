from __future__ import annotations
from sqlalchemy import Integer, Float, String, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class GLBalance(Base, TimestampMixin):
    """One row per (gl_account, accounting_period) — kept current by
    accounts/service.py's post_journal_entry() as the source of truth for
    "current balance". Materialized cache, recomputed from
    journal_entry_lines, never hand-edited — same rule as Store's
    StoreStockBalance."""

    __tablename__ = "gl_balances"
    __table_args__ = (UniqueConstraint("gl_account_id", "accounting_period", name="uq_gl_balance_account_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gl_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=False, index=True)
    accounting_period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)

    opening_balance: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    total_debits: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    total_credits: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    closing_balance: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # Blocks new postings to this account for this period once set — Phase 5
    # (Period Closing) is what ever sets this True; dormant until then.
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
