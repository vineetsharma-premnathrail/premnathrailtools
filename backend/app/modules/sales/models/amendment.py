"""Customer changes to a confirmed order (plan §4.4 / §6.4). The proposal is a
full copy of the amendable parts of the SO (header terms, lines, schedule,
billing plan); `changes` is the old → new diff computed by the service."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

# draft → pending_approval → approved (applied to the SO) / rejected / cancelled
SALES_AMENDMENT_STATUSES = ("draft", "pending_approval", "approved", "rejected", "cancelled")
SALES_AMENDMENT_OPEN_STATUSES = ("draft", "pending_approval")


class SalesOrderAmendment(Base, TimestampMixin):
    __tablename__ = "sales_order_amendments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    so_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    amendment_no: Mapped[int] = mapped_column(Integer, nullable=False)
    customer_amendment_ref: Mapped[str | None] = mapped_column(String(150), nullable=True)
    customer_amendment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    proposed: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    changes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    value_change: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    new_grand_total: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    deviation_flags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    required_approval_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    approval_round: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
