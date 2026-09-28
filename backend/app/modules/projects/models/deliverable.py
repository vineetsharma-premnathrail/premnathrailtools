from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

PM_DELIVERABLE_STATUSES = ("not_started", "in_progress", "submitted", "accepted", "rejected")


class PmDeliverable(Base, TimestampMixin):
    """A deliverable owed against a Project Management module project,
    optionally tied to a milestone. Table `pm_project_deliverables`, FK'd to
    `pm_projects.id`, `pm_project_milestones.id`, and `users.id`."""

    __tablename__ = "pm_project_deliverables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    milestone_id: Mapped[int | None] = mapped_column(ForeignKey("pm_project_milestones.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="not_started", nullable=False)
