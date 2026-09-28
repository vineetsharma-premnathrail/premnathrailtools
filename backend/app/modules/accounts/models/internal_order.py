from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

INTERNAL_ORDER_TYPES = ("capital", "maintenance", "it", "training")
INTERNAL_ORDER_STATUSES = ("open", "in_progress", "completed", "closed")


class InternalOrder(Base, TimestampMixin):
    """A budgeted, time-bound spend tracker (capital project, maintenance
    job, etc). `actual_amount`/`variance` are deliberately NOT columns here —
    once Phase 2 (Ledger Engine) exists they're computed at read time from
    linked journal_entry_lines, never a separately-maintained running total."""

    __tablename__ = "internal_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_type: Mapped[str] = mapped_column(String(20), nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    budgeted_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
