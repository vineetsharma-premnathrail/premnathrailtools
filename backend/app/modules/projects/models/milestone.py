from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

PM_MILESTONE_STATUSES = ("pending", "achieved", "missed")


class PmProjectMilestone(Base, TimestampMixin):
    """A milestone within a Project Management module project. Table
    `pm_project_milestones`, FK'd to `pm_projects.id` and optionally
    `pm_project_phases.id`."""

    __tablename__ = "pm_project_milestones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    phase_id: Mapped[int | None] = mapped_column(ForeignKey("pm_project_phases.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_date: Mapped[date] = mapped_column(Date, nullable=False)
    actual_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
