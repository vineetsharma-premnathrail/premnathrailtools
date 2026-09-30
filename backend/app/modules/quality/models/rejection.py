from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

QUALITY_REJECTION_DISPOSITIONS = ("return_to_vendor", "scrap", "rework", "use_as_is")
QUALITY_REJECTION_STATUSES = ("open", "in_progress", "closed")


class QualityRejection(Base, TimestampMixin, SoftDeleteMixin):
    """A rejected batch/item — optionally linked to an NCR and/or the
    inspection that flagged it — tracked through to its disposition."""

    __tablename__ = "quality_rejections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rejection_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    ncr_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_ncrs.id"), nullable=True)
    inspection_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspections.id"), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    disposition: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)
    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Denormalized display name — no FK, same pattern as
    # QualityInspection.vendor_name (vendors aren't a first-class table yet).
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rejection_date: Mapped[date] = mapped_column(Date, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
