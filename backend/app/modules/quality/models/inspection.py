from __future__ import annotations
from datetime import date
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.quality.models.inspection import QualityInspectionResult, QualityInspectionAttachment

QUALITY_INSPECTION_STATUSES = ("pending", "in_progress", "passed", "failed", "conditionally_passed")
QUALITY_INSPECTION_RESULT_VALUES = ("pass", "fail", "na")


class QualityInspection(Base, TimestampMixin, SoftDeleteMixin):
    """A single inspection instance (incoming / in-process / final) raised
    against a plan (optionally) for a batch/item — the actual pass/fail
    record."""

    __tablename__ = "quality_inspections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inspection_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    inspection_type: Mapped[str] = mapped_column(String(20), nullable=False)
    inspection_plan_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspection_plans.id"), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quantity_inspected: Mapped[float | None] = mapped_column(Float, nullable=True)
    quantity_accepted: Mapped[float | None] = mapped_column(Float, nullable=True)
    quantity_rejected: Mapped[float | None] = mapped_column(Float, nullable=True)
    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Denormalized display name — no FK, same pattern as
    # P2PPurchaseOrder.vendor_name (vendors aren't a first-class table yet).
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    p2p_request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=True)
    project_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    inspected_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    inspection_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    results: Mapped[list["QualityInspectionResult"]] = relationship(
        "QualityInspectionResult", back_populates="inspection", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["QualityInspectionAttachment"]] = relationship(
        "QualityInspectionAttachment", back_populates="inspection", cascade="all, delete-orphan"
    )


class QualityInspectionResult(Base, TimestampMixin):
    """A single parameter/method/acceptance-criteria/observed-value/result
    row recorded against a QualityInspection."""

    __tablename__ = "quality_inspection_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inspection_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_inspections.id"), nullable=False)
    parameter: Mapped[str] = mapped_column(String(255), nullable=False)
    method: Mapped[str | None] = mapped_column(String(255), nullable=True)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    observed_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    result: Mapped[str | None] = mapped_column(String(10), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    inspection: Mapped["QualityInspection"] = relationship("QualityInspection", back_populates="results")


class QualityInspectionAttachment(Base, TimestampMixin):
    """A file attached to a QualityInspection. Uses TimestampMixin's
    created_at as the uploaded-at timestamp — no separate column needed."""

    __tablename__ = "quality_inspection_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inspection_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_inspections.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    inspection: Mapped["QualityInspection"] = relationship("QualityInspection", back_populates="attachments")
