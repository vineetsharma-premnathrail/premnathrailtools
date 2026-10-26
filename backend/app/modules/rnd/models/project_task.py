from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

RND_PROJECT_TASK_STATUSES = ("open", "submitted", "closed", "cancelled")


class RndProjectTask(Base, TimestampMixin):
    """Work a project lead hands to a project team member — same flow as the
    requirement tasks (requirement_work.py): lead creates → assignee works and
    submits → lead closes or sends it back. The assignee of an open task can
    create sub-tasks for the project team; the creator of any task can edit it. Files are RndDocument rows with
    task_id set (task_doc_role "brief" = lead's, "work" = assignee's)."""

    __tablename__ = "rnd_project_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_projects.id"), index=True, nullable=False)
    # Sub-task: the parent's assignee split their work and handed this part on.
    # The sub-task's creator reviews it, like a lead reviews a top-level task.
    parent_task_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_project_tasks.id", ondelete="CASCADE"), index=True, nullable=True)
    # The plan milestone this task belongs to (sub-tasks copy their parent's).
    # NULL on tasks created before milestones existed.
    milestone_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_project_milestones.id", ondelete="SET NULL"), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_to_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    created_by_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    original_due_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Planning fields (services/task_fields.py): priority, start date, the
    # assignee's work status while open, and the checklist (definition of done).
    priority: Mapped[str] = mapped_column(String(10), nullable=False, default="medium", server_default="medium")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    work_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_started", server_default="not_started")
    checklist: Mapped[list | None] = mapped_column(JSON, nullable=True)


class RndProjectTaskEvent(Base):
    """History line on a project task (created / extended / submitted / closed / reopened / cancelled)."""

    __tablename__ = "rnd_project_task_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_project_tasks.id", ondelete="CASCADE"), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    old_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    new_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
