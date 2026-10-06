from __future__ import annotations
from sqlalchemy import String, Integer, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# What gets measured. "variable" = a measured number checked against
# min/max (a diameter, a hardness), "attribute" = a pass/fail check
# (visual, go/no-go gauge, presence of a marking).
QUALITY_CHARACTERISTIC_TYPES = ("variable", "attribute")

# How bad a failure of this characteristic is. Critical characteristics are
# always inspected 100% and a lot with a failed critical characteristic can
# never be accepted (rule 4) — it must go NCR → Design → customer.
QUALITY_CHARACTERISTIC_CLASSES = ("critical", "major", "minor")


class QualityCharacteristic(Base, TimestampMixin):
    """Inspection characteristic master — the "what" of an inspection plan
    line (what to check, in which unit, by which method, with which gauge
    type, and how serious a failure is). Retired with is_active=false,
    never deleted, so old plans and results keep their reference."""

    __tablename__ = "quality_characteristics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    char_type: Mapped[str] = mapped_column(String(20), default="variable", nullable=False)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    method: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gauge_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    classification: Mapped[str] = mapped_column(String(20), default="minor", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
