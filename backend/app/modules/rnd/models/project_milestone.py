from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

# Same plan as Project Management milestones: Not started → In progress
# (set by hand, or automatically when its first task is created) ⇄ On hold
# (with a reason) → Achieved (every task finished). A lead can reopen an
# achieved one or cancel an open one — both with a reason.
RND_MILESTONE_STATUSES = ("todo", "in_progress", "blocked", "done", "cancelled")
RND_MILESTONE_OPEN = ("todo", "in_progress", "blocked")
RND_MILESTONE_STATUS_LABELS = {
    "todo": "Not Started", "in_progress": "In Progress", "blocked": "On Hold", "done": "Achieved", "cancelled": "Cancelled",
}
# Look on the plan timeline — the same set as PM (projects/models/task.py).
RND_MILESTONE_COLORS = ("#2563eb", "#0284c7", "#16a34a", "#f59e0b", "#7c3aed", "#e11d48", "#0d9488", "#475569", "#ea580c", "#db2777")
RND_MILESTONE_ICONS = ("flag", "target", "star", "gear", "truck", "box", "check", "calendar", "clip", "user")


class RndProjectMilestone(Base, TimestampMixin):
    """A step of a Prototype / Research project's plan — one responsible
    person (plus optional co-owners) and an expected achievable date. The
    project's tasks are created inside a milestone (rnd_project_tasks.milestone_id)
    and its progress is the share of those tasks that are finished."""

    __tablename__ = "rnd_project_milestones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_projects.id"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # What "achieved" means — the deliverable / completion criteria.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    assignee_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    co_owner_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="todo", server_default="todo")
    blocker_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reopen_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
