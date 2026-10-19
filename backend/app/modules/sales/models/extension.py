"""Delivery-period (DP) extension (plan §4.8). Granted on the customer's
letter; moves the affected rows' current_delivery_date, and "without LD"
waives LD on them."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import String, Integer, Boolean, Date, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

SALES_EXTENSION_STATUSES = ("requested", "granted", "refused")
SALES_EXTENSION_REASONS = ("customer_cause", "force_majeure", "our_cause")


class SalesDeliveryExtension(Base, TimestampMixin):
    __tablename__ = "sales_delivery_extensions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    so_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    schedule_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    requested_on: Mapped[date] = mapped_column(Date, nullable=False)
    requested_new_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason_category: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    customer_letter_ref: Mapped[str | None] = mapped_column(String(150), nullable=True)
    customer_letter_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    granted_new_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    with_ld: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    token_penalty_amount: Mapped[float | None] = mapped_column(Money, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="requested", index=True, nullable=False)
    decision_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
