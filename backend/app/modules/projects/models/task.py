from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

PM_TASK_STATUSES = ("not_started", "in_progress", "blocked", "completed", "cancelled")
PM_TASK_PRIORITIES = ("low", "medium", "high", "critical")


class PmProjectTask(Base, TimestampMixin):
    """A task (optionally a subtask, via `parent_task_id`) within a Project
    Management module project. Table `pm_project_tasks`, FK'd to
    `pm_projects.id` and optionally `pm_project_phases.id`."""

    __tablename__ = "pm_project_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    phase_id: Mapped[int | None] = mapped_column(ForeignKey("pm_project_phases.id"), nullable=True)
    parent_task_id: Mapped[int | None] = mapped_column(ForeignKey("pm_project_tasks.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="not_started", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    percent_complete: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
