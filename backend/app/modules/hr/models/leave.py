from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Boolean, Text, Date, DateTime, Numeric, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

LEAVE_SESSIONS = ("full", "first_half", "second_half")
LEAVE_REQUEST_STATUSES = ("pending", "approved", "rejected", "cancelled")


class HrLeaveType(Base, TimestampMixin):
    __tablename__ = "hr_leave_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    annual_quota: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0, server_default="0", nullable=False)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    carry_forward: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    max_carry_forward: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0, server_default="0", nullable=False)
    allow_half_day: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    requires_document_after_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 'female' / 'male' / NULL (any)
    gender_restriction: Mapped[str | None] = mapped_column(String(10), nullable=True)
    max_consecutive_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)


class HrLeaveBalance(Base, TimestampMixin):
    """Per user / leave type / calendar year. available = opening + allotted
    + adjusted - used."""

    __tablename__ = "hr_leave_balances"
    __table_args__ = (UniqueConstraint("user_id", "leave_type_id", "year", name="uq_hr_leave_balances_user_type_year"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    leave_type_id: Mapped[int] = mapped_column(ForeignKey("hr_leave_types.id"), index=True, nullable=False)
    year: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    opening: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0, server_default="0", nullable=False)
    allotted: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0, server_default="0", nullable=False)
    adjusted: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0, server_default="0", nullable=False)
    used: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0, server_default="0", nullable=False)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    @property
    def available(self) -> Decimal:
        return (self.opening or 0) + (self.allotted or 0) + (self.adjusted or 0) - (self.used or 0)


class HrLeaveRequest(Base, TimestampMixin):
    """LV-YYYY-NNNN. approver_id is captured at submission from the
    requester's User.reporting_manager_id (NULL = any hr-app user decides)."""

    __tablename__ = "hr_leave_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_no: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    leave_type_id: Mapped[int] = mapped_column(ForeignKey("hr_leave_types.id"), index=True, nullable=False)
    from_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    to_date: Mapped[date] = mapped_column(Date, nullable=False)
    from_session: Mapped[str] = mapped_column(String(20), default="full", server_default="full", nullable=False)
    to_session: Mapped[str] = mapped_column(String(20), default="full", server_default="full", nullable=False)
    days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_during_leave: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    attachment_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True, nullable=False)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
