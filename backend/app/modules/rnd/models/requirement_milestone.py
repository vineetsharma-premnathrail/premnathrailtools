from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin
# Status constants are shared with the project plan (RND_MILESTONE_STATUSES etc.).
from app.modules.rnd.models.project_milestone import (  # noqa: F401
    RND_MILESTONE_COLORS,
    RND_MILESTONE_ICONS,
    RND_MILESTONE_OPEN,
    RND_MILESTONE_STATUS_LABELS,
    RND_MILESTONE_STATUSES,
)


class RndRequirementMilestone(Base, TimestampMixin):
    """A step of an R&D requirement's plan (CRM Inquiry / Tender sent to R&D),
    addressed by (source, record_id) like rnd_requirement_tasks. The
    requirement's tasks sit inside it (rnd_requirement_tasks.milestone_id)."""

    __tablename__ = "rnd_requirement_milestones"
    __table_args__ = (
        CheckConstraint("source IN ('inquiry','tender')", name="ck_rnd_requirement_milestones_source"),
        Index("ix_rnd_requirement_milestones_source_record", "source", "record_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # "inquiry" | "tender"
    record_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
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
