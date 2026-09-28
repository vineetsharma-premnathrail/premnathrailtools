from __future__ import annotations
from sqlalchemy import String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

QUALITY_SUPPLIER_SCORECARD_STATUSES = ("draft", "final")


class QualitySupplierScorecard(Base, TimestampMixin):
    """A periodic quality scorecard for a vendor — rolls up rejection/NCR
    counts and quality/delivery scores for that period."""

    __tablename__ = "quality_supplier_scorecards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Denormalized display name — no FK, same pattern as
    # QualityInspection.vendor_name.
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Free-text like "2026-Q1" or "2026-03" — no enum, caller's convention.
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    on_time_delivery_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    rejection_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ncr_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(10), default="draft", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
