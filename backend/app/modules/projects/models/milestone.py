from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import JSON, String, Integer, Text, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Not started → In progress (system: first task started) → Submitted
# (department head, all tasks done) → Achieved (management accepted).
# Rejected goes back to In progress. Cancelled = no longer needed, with a
# reason. "Overdue" and "At risk" are NOT statuses — they're computed from
# dates on every read (workflow.milestone_flags).
PM_MILESTONE_STATUSES = ("not_started", "in_progress", "submitted", "achieved", "cancelled")

# How a step is gated (precedence, like a project network):
#   after_previous      every step above it is achieved (finish-to-start, default)
#   with_previous       runs in parallel with the step just above (same gate)
#   after_step_done     only the chosen step (depends_on_milestone_id) is achieved
#   after_step_started  the chosen step has started (start-to-start overlap)
PM_START_RULES = {
    "after_previous": "After all steps above are achieved",
    "with_previous": "Together with the step above (parallel)",
    "after_step_done": "After a chosen step is achieved",
    "after_step_started": "Once a chosen step has started (overlap)",
}


class PmProjectMilestone(Base, TimestampMixin):
    """A commitment one department owes the project by a date. Table
    `pm_project_milestones`."""

    __tablename__ = "pm_project_milestones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True, index=True)
    # Position in the project's chain (1, 2, 3 ...). Milestones run strictly
    # in this order: work on step N can't start until every earlier step
    # (except cancelled ones) is Achieved.
    sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    # The person who represents the department on this milestone. Acts as
    # its head: plans and assigns tasks, submits it. The department's own
    # heads (Organization › Departments) keep the same rights.
    lead_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    # Assistants: the rest of the milestone team. They see the milestone
    # name and date, their own tasks, and the team chat — not its progress.
    assistant_user_ids: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # Deliverable / completion criteria — the agreed meaning of "done".
    deliverable: Mapped[str | None] = mapped_column(Text, nullable=True)
    depends_on_milestone_id: Mapped[int | None] = mapped_column(ForeignKey("pm_project_milestones.id"), nullable=True)
    # When work on this step may start (see PM_START_RULES). Steps usually run
    # top to bottom, but some overlap — e.g. purchase and production start
    # while design is still changing — so each step says what it waits for.
    start_rule: Mapped[str] = mapped_column(String(20), default="after_previous", server_default="after_previous", nullable=False)
    target_date: Mapped[date] = mapped_column(Date, nullable=False)
    # The first committed date, kept when management moves the target date,
    # so slippage is always visible.
    original_target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="not_started", nullable=False)

    submitted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Department's handover note: what is attached as evidence and anything
    # management should check. Evidence files are documents with milestone_id.
    submission_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    achieved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    achieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Last reason management rejected a submission.
    return_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
