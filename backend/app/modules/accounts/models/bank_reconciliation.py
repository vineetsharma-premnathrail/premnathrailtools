from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

BANK_RECONCILIATION_STATUSES = ("in_progress", "completed")


class BankReconciliation(Base, TimestampMixin):
    """A point-in-time comparison of a bank statement against this book's
    balance for that bank account. outstanding_cheques/deposits_in_transit
    are NOT columns here — always computed at read time from unreconciled
    PaymentTransaction rows (see accounts/service.py's
    compute_reconciliation_summary), never separately entered. See
    old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 6."""

    __tablename__ = "bank_reconciliations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bank_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("bank_accounts.id"), nullable=False)
    statement_date: Mapped[date] = mapped_column(Date, nullable=False)
    statement_balance: Mapped[float] = mapped_column(Float, nullable=False)
    # Snapshot of BankAccount.current_balance at creation time — never
    # recomputed afterwards, so this record stays a faithful point-in-time
    # comparison even as later transactions move the live balance.
    book_balance: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="in_progress")
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
