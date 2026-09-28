from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

QUALITY_STANDARD_STATUSES = ("active", "draft", "obsolete")


class QualityStandard(Base, TimestampMixin):
    """A reference quality standard/specification (e.g. an internal SOP or an
    external standard) that inspection plans and checklists can be linked
    against."""

    __tablename__ = "quality_standards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    standard_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
