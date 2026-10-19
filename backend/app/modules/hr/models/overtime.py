"""Overtime (OT) approvals from time evaluation (SAP PT60 equivalent).

Time evaluation (services/time_evaluation.py) computes OT per day from the
attendance check-in / check-out (Factories Act 1948 s.59: beyond 9 hours in
a day or 48 hours in a week). The portal stores OT HOURS only — the double
rate is paid by ADP payroll from the monthly export, which carries only the
APPROVED minutes. One live request per employee per day.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

OVERTIME_STATUSES = ("pending", "approved", "rejected", "cancelled")
OVERTIME_SOURCES = ("self", "evaluation")


class HrOvertime(Base, TimestampMixin):
    """OT-YYYY-NNNN."""

    __tablename__ = "hr_overtime"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_no: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    work_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    # What time evaluation computed when the request was raised.
    computed_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    claimed_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    approved_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True, nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="self", server_default="self", nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
