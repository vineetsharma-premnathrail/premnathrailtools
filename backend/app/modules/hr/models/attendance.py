from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Text, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

ATTENDANCE_STATUSES = ("present", "absent", "half_day", "on_leave", "holiday", "weekly_off", "on_duty", "work_from_home")
ATTENDANCE_SOURCES = ("manual", "self", "regularization", "leave", "import")
REGULARIZATION_STATUSES = ("pending", "approved", "rejected", "cancelled")


class HrAttendance(Base, TimestampMixin):
    """One row per user per day."""

    __tablename__ = "hr_attendance"
    __table_args__ = (UniqueConstraint("user_id", "attendance_date", name="uq_hr_attendance_user_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    attendance_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    check_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("hr_shifts.id"), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    marked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class HrAttendanceRegularization(Base, TimestampMixin):
    """AR-YYYY-NNNN — employee's request to correct a day's attendance."""

    __tablename__ = "hr_attendance_regularizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_no: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    attendance_date: Mapped[date] = mapped_column(Date, nullable=False)
    requested_status: Mapped[str] = mapped_column(String(20), nullable=False)
    check_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True, nullable=False)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
