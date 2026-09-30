from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

MAINTENANCE_REQUEST_TYPES = ("breakdown", "abnormality", "improvement", "safety")
MAINTENANCE_PRIORITIES = ("low", "normal", "high", "urgent")
# open → acknowledged → converted (to a work order), or rejected / duplicate.
MAINTENANCE_REQUEST_STATUSES = ("open", "acknowledged", "converted", "rejected", "duplicate")


class MaintenanceRequest(Base, TimestampMixin):
    """A breakdown / maintenance request raised from the shop floor (MRQ-).
    If `machine_down`, the downtime clock starts at `reported_at` and runs
    until the work order hands the machine back."""

    __tablename__ = "maintenance_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_assets.id"), index=True, nullable=False)
    request_type: Mapped[str] = mapped_column(String(20), default="breakdown", nullable=False)
    machine_down: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    problem_description: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str] = mapped_column(String(10), default="normal", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)

    raised_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The work order a converted request became is MaintenanceWorkOrder.request_id
    # (one direction only, so the two tables don't FK each other).
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
