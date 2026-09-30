from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

QUALITY_NCR_SOURCES = ("inspection", "complaint", "internal")
QUALITY_NCR_SEVERITIES = ("minor", "major", "critical")
QUALITY_NCR_STATUSES = ("open", "under_review", "capa_assigned", "closed", "rejected", "cancelled")


class QualityNcr(Base, TimestampMixin, SoftDeleteMixin):
    """A Non-Conformance Report — raised against an inspection, a customer
    complaint, or an internal finding — that feeds the CAPA loop."""

    __tablename__ = "quality_ncrs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ncr_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="minor", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)
    inspection_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspections.id"), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    raised_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    ncr_date: Mapped[date] = mapped_column(Date, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
