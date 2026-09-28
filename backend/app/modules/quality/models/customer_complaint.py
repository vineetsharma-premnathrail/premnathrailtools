from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

QUALITY_COMPLAINT_SEVERITIES = ("minor", "major", "critical")
QUALITY_COMPLAINT_STATUSES = ("open", "under_investigation", "capa_assigned", "resolved", "closed", "rejected")


class QualityCustomerComplaint(Base, TimestampMixin):
    """A complaint raised by a customer against delivered goods/services —
    tracked through investigation to resolution/CAPA and close."""

    __tablename__ = "quality_customer_complaints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    complaint_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    # Denormalized free-text — no enforced CRM FK, same pattern as
    # QualityInspection.vendor_name.
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Plain int, no FK — CRM organizations aren't guaranteed reachable from
    # here; denormalized reference only.
    customer_org_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="minor", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="open", nullable=False)
    complaint_date: Mapped[date] = mapped_column(Date, nullable=False)
    received_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
