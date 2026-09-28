from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

PM_APPROVAL_TYPES = ("budget", "change_request", "closure", "other")
PM_APPROVAL_STATUSES = ("pending", "approved", "rejected")


class PmApproval(Base):
    """An approval request raised against a Project Management module
    project. Table `pm_project_approvals`, FK'd to `pm_projects.id` and
    `users.id`. `reference_id` is a plain free integer (NOT a hard FK)
    pointing at the change_request/budget_line/etc. row it's for, since
    it can reference different tables depending on `approval_type` — same
    "reference is polymorphic, not FK'd" pattern as
    `store_stock_transactions.reference_number`."""

    __tablename__ = "pm_project_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    approval_type: Mapped[str] = mapped_column(String(30), nullable=False)
    reference_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
