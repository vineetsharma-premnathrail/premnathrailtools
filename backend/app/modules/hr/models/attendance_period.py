"""Attendance period lock before the ADP payroll cut-off (SAP PA03 control
record equivalent: payroll past / exit / correction).

One row per month and plant (`branch_id` NULL = every plant). While a
period is locked, nothing may change the attendance of that month for
that plant: marking, bulk marking, imports, punch evaluation, roster
changes, regularization approvals and leave approval/cancellation all get a
409 that names the month and plant. Unlock is a Partner decision with a
mandatory reason; every lock/unlock is kept in `history` and the audit log.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

PERIOD_STATUSES = ("open", "locked")


class HrAttendancePeriod(Base, TimestampMixin):
    __tablename__ = "hr_attendance_periods"
    __table_args__ = (UniqueConstraint("year", "month", "branch_id", name="uq_hr_attendance_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="open", server_default="open", nullable=False)
    locked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    unlocked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    unlocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    unlock_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    history: Mapped[list | None] = mapped_column(JSON, nullable=True)
