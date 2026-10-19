from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import JSON, String, Integer, Text, Date, DateTime, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# To do → In progress ⇄ Blocked (reason) → Done. The department head can
# reopen a Done task (back to In progress, with a reason) until the
# milestone is submitted, or cancel an open one (with a reason).
PM_TASK_STATUSES = ("todo", "in_progress", "blocked", "done", "cancelled")
PM_TASK_OPEN_STATUSES = ("todo", "in_progress", "blocked")
PM_TASK_PRIORITIES = ("low", "medium", "high", "critical")
# A milestone's task: To do → In progress ⇄ On hold → Done (its checklist
# ticked first). Its checklist items are only todo / done.
PM_SUBTASK_STATUSES = ("todo", "in_progress", "on_hold", "done")
# Milestone look on the plan timeline (Project Plan & Milestones).
PM_MILESTONE_COLORS = ("#2563eb", "#0284c7", "#16a34a", "#f59e0b", "#7c3aed", "#e11d48", "#0d9488", "#475569", "#ea580c", "#db2777")
PM_MILESTONE_ICONS = ("flag", "target", "star", "gear", "truck", "box", "check", "calendar", "clip", "user")


class PmProjectTask(Base, TimestampMixin):
    """One piece of work under a WBS, created by the department head
    and assigned to one person in the department. Table `pm_project_tasks`."""

    __tablename__ = "pm_project_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    milestone_id: Mapped[int | None] = mapped_column(ForeignKey("pm_project_milestones.id"), nullable=True, index=True)
    # Department task (Tasks tab, no WBS): the department that owes it. Its
    # head may split it into sub-tasks for their people.
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    # Milestones: further responsible people besides assignee_id (user ids).
    co_owner_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="todo", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Milestones (no WBS): planned start, and how it looks on the plan timeline.
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(20), nullable=True)
    estimated_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    blocker_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reopen_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class PmTaskSubtask(Base, TimestampMixin):
    """A smaller step the assignee splits their own task into. Table
    `pm_task_subtasks`. The task can't be Done while any sub-task is open."""

    __tablename__ = "pm_task_subtasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("pm_project_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    # NULL: a task of the milestone. Set: a sub-task the task's assignee
    # split it into (task_id is still the milestone).
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("pm_task_subtasks.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Department tasks: the person the department head gives this sub-task to.
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    # People who help the assignee: notified, see it in My Tasks, add remarks and files.
    collaborator_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="medium", server_default="medium", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="todo", nullable=False)
    labels: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PmTaskUpdate(Base, TimestampMixin):
    """Task comments (kind="comment") and every status change (kind="status")
    with who and when. Table `pm_task_updates`."""

    __tablename__ = "pm_task_updates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("pm_project_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    # Set when the remark is on one sub-task of a department task.
    subtask_id: Mapped[int | None] = mapped_column(ForeignKey("pm_task_subtasks.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), default="comment", nullable=False)  # comment | status
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # People tagged with @ in a comment — notified, and allowed to open the task.
    mention_user_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)


class PmTaskTimeLog(Base, TimestampMixin):
    """Hours the assignee spent on a task on one day. Table
    `pm_task_time_logs`. Actual effort vs the head's estimate."""

    __tablename__ = "pm_task_time_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("pm_project_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    hours: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class PmMilestoneMessage(Base, TimestampMixin):
    """Team chat on a WBS — the lead, assistants, department heads,
    management, and anyone tagged with @ (e.g. R&D tagging Purchase).
    Files sent in the chat are PmProjectDocument rows with message_id set.
    Table `pm_milestone_messages`."""

    __tablename__ = "pm_milestone_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    milestone_id: Mapped[int] = mapped_column(ForeignKey("pm_project_milestones.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    mention_user_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
