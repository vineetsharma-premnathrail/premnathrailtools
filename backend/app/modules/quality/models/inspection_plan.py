from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Which stage of the material/production flow a plan or inspection applies
# to. Shared between QualityInspectionPlan.inspection_type and
# QualityInspection.inspection_type.
QUALITY_INSPECTION_TYPES = ("incoming", "in_process", "final")

QUALITY_INSPECTION_PLAN_STATUSES = ("active", "inactive")


class QualityInspectionPlan(Base, TimestampMixin):
    """A reusable inspection plan for a given item, defining which checklist
    and standard to inspect against and what sampling plan to use — actual
    QualityInspection records are raised against a plan."""

    __tablename__ = "quality_inspection_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    inspection_type: Mapped[str] = mapped_column(String(20), nullable=False)
    checklist_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_checklists.id"), nullable=True)
    standard_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_standards.id"), nullable=True)
    sampling_plan: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
