from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Boolean, Text, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

HOLIDAY_TYPES = ("national", "festival", "restricted", "optional")


class HrHoliday(Base, TimestampMixin):
    """Holiday calendar entry. `branch_id` NULL means it applies at every plant."""

    __tablename__ = "hr_holidays"
    __table_args__ = (UniqueConstraint("holiday_date", "branch_id", "name", name="uq_hr_holidays_date_branch_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    holiday_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    holiday_type: Mapped[str] = mapped_column(String(20), default="national", server_default="national", nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    year: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
