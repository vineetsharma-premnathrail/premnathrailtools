from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Boolean, Text, Date, DateTime, Numeric, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

TRAVEL_MODES = ("air", "train", "bus", "car", "company_vehicle", "other")
TRAVEL_STATUSES = ("pending", "approved", "rejected", "cancelled", "completed")


class HrTravelRequest(Base, TimestampMixin):
    """TR-YYYY-NNNN business travel request."""

    __tablename__ = "hr_travel_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_no: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    from_city: Mapped[str] = mapped_column(String(100), nullable=False)
    to_city: Mapped[str] = mapped_column(String(100), nullable=False)
    depart_date: Mapped[date] = mapped_column(Date, nullable=False)
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    travel_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    accommodation_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    advance_required: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0", nullable=False)
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    project_reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True, nullable=False)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
