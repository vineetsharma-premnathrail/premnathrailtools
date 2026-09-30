from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

ELECTRICAL_ISSUE_SEVERITIES = ("minor", "major", "critical")
# open → investigating → resolved → closed (reopen puts it back to open).
# Troubleshooting is complete once nothing is open or investigating.
ELECTRICAL_ISSUE_STATUSES = ("open", "investigating", "resolved", "closed")
ELECTRICAL_OPEN_ISSUE_STATUSES = ("open", "investigating")


class ElectricalIssue(Base, TimestampMixin, SoftDeleteMixin):
    """A fault found during assembly, testing or commissioning, and how it
    was traced and fixed — the Troubleshooting log. Resolving needs a root
    cause and the corrective action taken."""

    __tablename__ = "electrical_issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("electrical_jobs.id"), index=True, nullable=False)
    issue_number: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    symptom: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(20), default="major", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True, nullable=False)
    test_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("electrical_tests.id"), nullable=True)
    panel_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("electrical_panels.id"), nullable=True)
    cable_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("electrical_cables.id"), nullable=True)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrective_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    reported_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    resolved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
