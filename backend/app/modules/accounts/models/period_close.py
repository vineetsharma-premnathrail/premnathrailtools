from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

PERIOD_CLOSE_STATUSES = ("open", "closed")


class PeriodClose(Base, TimestampMixin):
    """One row per accounting period that's ever been closed — a period
    with no row at all is implicitly open. Closing sets is_locked=True on
    every GLBalance row for the period AND makes post_journal_entry()'s
    lock check refuse postings to accounts that have never been touched in
    this period yet (no GLBalance row would otherwise exist to check). See
    old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 5."""

    __tablename__ = "period_close"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    accounting_period: Mapped[str] = mapped_column(String(7), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")

    closed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    close_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    reopened_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reopened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reopen_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
