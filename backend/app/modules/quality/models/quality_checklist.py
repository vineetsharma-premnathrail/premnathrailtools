from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.quality.models.quality_checklist import QualityChecklistItem

QUALITY_CHECKLIST_STATUSES = ("active", "inactive")


class QualityChecklist(Base, TimestampMixin, SoftDeleteMixin):
    """A reusable named checklist (set of parameters/methods/acceptance
    criteria) that an inspection plan can be linked to, and whose items are
    copied onto a QualityInspection's results when an inspection is raised
    against a plan using this checklist."""

    __tablename__ = "quality_checklists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    items: Mapped[list["QualityChecklistItem"]] = relationship(
        "QualityChecklistItem", back_populates="checklist", cascade="all, delete-orphan"
    )


class QualityChecklistItem(Base, TimestampMixin):
    """A single parameter/method/acceptance-criteria row on a QualityChecklist."""

    __tablename__ = "quality_checklist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    checklist_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_checklists.id"), nullable=False)
    parameter: Mapped[str] = mapped_column(String(255), nullable=False)
    method: Mapped[str | None] = mapped_column(String(255), nullable=True)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    checklist: Mapped["QualityChecklist"] = relationship("QualityChecklist", back_populates="items")
