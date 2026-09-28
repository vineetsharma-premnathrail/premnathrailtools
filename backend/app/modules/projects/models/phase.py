from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

PM_PHASE_STATUSES = ("not_started", "in_progress", "completed", "delayed")


class PmProjectPhase(Base, TimestampMixin):
    """A planning phase within a Project Management module project. Table
    `pm_project_phases`, FK'd to `pm_projects.id`."""

    __tablename__ = "pm_project_phases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    planned_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="not_started", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
