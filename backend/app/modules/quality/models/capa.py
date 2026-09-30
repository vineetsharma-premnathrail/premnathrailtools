from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

QUALITY_CAPA_ACTION_TYPES = ("corrective", "preventive")
QUALITY_CAPA_STATUSES = ("open", "in_progress", "pending_verification", "closed", "overdue")


class QualityCapa(Base, TimestampMixin, SoftDeleteMixin):
    """A Corrective or Preventive Action — raised against an NCR (or, from
    Phase 3, a customer complaint) — tracked through to verification/close."""

    __tablename__ = "quality_capas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    capa_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    action_type: Mapped[str] = mapped_column(String(20), nullable=False)
    ncr_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_ncrs.id"), nullable=True)
    complaint_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("quality_customer_complaints.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_plan: Mapped[str] = mapped_column(Text, nullable=False)
    responsible_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    verification_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="open", nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
