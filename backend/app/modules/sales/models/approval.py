"""Approval history (plan §4.10) — one row per decision. `revision` is the
approval round of the order / amendment, so decisions from an earlier round
(before a return) never count towards the current one."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

SALES_APPROVAL_ENTITIES = ("sales_order", "sales_amendment")
SALES_APPROVAL_DECISIONS = ("approved", "rejected", "returned")


class SalesApproval(Base, TimestampMixin):
    __tablename__ = "sales_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    level: Mapped[str] = mapped_column(String(20), nullable=False)
    approver_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    decision: Mapped[str] = mapped_column(String(20), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    stand_in: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
