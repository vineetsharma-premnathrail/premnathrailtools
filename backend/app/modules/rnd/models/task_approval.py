from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

RND_TASK_KINDS = ("requirement", "project")
RND_APPROVAL_STATUSES = ("pending", "approved", "rejected", "withdrawn")


class RndTaskApproval(Base):
    """An approval the assignee asks for *while working* on an R&D task — e.g.
    "approve this drawing / this material / this deviation". It is not how a
    task finishes: the assignee completes the task themselves. The person who
    gave the task (or the R&D head / project lead) approves or rejects with
    remarks; the task stays open either way. One pending request per task.

    task_kind says which task table task_id points to (requirement tasks or
    project tasks). document_ids = the files attached to the request, stored
    with the task's other files."""

    __tablename__ = "rnd_task_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    task_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    request: Mapped[str] = mapped_column(Text, nullable=False)
    document_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    requested_by_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
