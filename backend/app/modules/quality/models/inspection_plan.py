from __future__ import annotations
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Text, DateTime, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.quality.models.characteristic import QualityCharacteristic

# Inspection points (the document that triggers a lot). Shared between
# QualityInspectionPlan.inspection_type, QualityInspectionLot.inspection_type
# and the legacy QualityInspection.inspection_type. Phase 1 creates
# incoming + final lots; the rest are defined now so later phases don't
# need a data migration.
QUALITY_INSPECTION_TYPES = (
    "incoming", "job_work", "first_article", "in_process", "final",
    "third_party", "sales_return", "stock_reinspection",
)
QUALITY_INSPECTION_TYPE_LABELS = {
    "incoming": "Incoming (GRN)", "job_work": "Job work receipt", "first_article": "First article (FAI)",
    "in_process": "In-process", "final": "Final (production)", "third_party": "Customer / third-party",
    "sales_return": "Sales return", "stock_reinspection": "Stock re-inspection",
}

# draft → approved → obsolete. Only an approved plan can be used for a lot
# (rule 2), and only one approved plan may exist per item + inspection type
# (the "current" revision) — enforced by the partial unique index below and
# by services.plans.approve_plan, which obsoletes the previous revision.
# Legacy values "active"/"inactive" were migrated to draft/obsolete.
# pending_approval = submitted to Organization › Approval Workflows ›
# Inspection plan (services/authz.py); approval → approved, return /
# reject / withdraw → draft.
QUALITY_INSPECTION_PLAN_STATUSES = ("draft", "pending_approval", "approved", "obsolete")

# How the sample size is worked out: "aql" = ISO 2859-1 / IS 2500 single
# sampling table, "full" = 100% of the lot, "fixed" = a fixed quantity.
QUALITY_SAMPLING_TYPES = ("aql", "full", "fixed")
QUALITY_INSPECTION_LEVELS = ("I", "II", "III")


class QualityInspectionPlan(Base, TimestampMixin, SoftDeleteMixin):
    """Inspection plan = item × inspection type × revision. Its lines say
    which characteristics to check, against which nominal/min/max, and with
    what sampling. Lots copy the plan's lines at the moment the plan is
    attached, so later revisions never change a recorded inspection."""

    __tablename__ = "quality_inspection_plans"
    __table_args__ = (
        Index(
            "uq_quality_plan_one_approved", "item_id", "inspection_type", unique=True,
            postgresql_where=text("status = 'approved' AND is_deleted = false"),
            sqlite_where=text("status = 'approved' AND is_deleted = 0"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=True)
    # Snapshot of the item at plan creation (legacy plans only have these).
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    inspection_type: Mapped[str] = mapped_column(String(20), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    # The approved plan this revision replaces (set by "New revision").
    supersedes_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspection_plans.id"), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)

    sampling_type: Mapped[str] = mapped_column(String(10), default="aql", server_default="aql", nullable=False)
    aql: Mapped[float | None] = mapped_column(Float, nullable=True)
    inspection_level: Mapped[str] = mapped_column(String(5), default="II", server_default="II", nullable=False)
    fixed_sample_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Legacy links (pre-Phase-1 plans). New plans use lines instead.
    checklist_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_checklists.id"), nullable=True)
    standard_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_standards.id"), nullable=True)
    sampling_plan: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    obsoleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lines: Mapped[list["QualityInspectionPlanLine"]] = relationship(
        "QualityInspectionPlanLine", back_populates="plan", cascade="all, delete-orphan",
        order_by="QualityInspectionPlanLine.sequence",
    )


class QualityInspectionPlanLine(Base, TimestampMixin):
    """One characteristic to check on a plan: nominal/min/max for variable
    characteristics, and an optional AQL that overrides the plan's."""

    __tablename__ = "quality_inspection_plan_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_inspection_plans.id"), index=True, nullable=False)
    characteristic_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_characteristics.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    nominal: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Defaults to the characteristic's own classification / method.
    classification: Mapped[str | None] = mapped_column(String(20), nullable=True)
    method: Mapped[str | None] = mapped_column(String(255), nullable=True)
    aql: Mapped[float | None] = mapped_column(Float, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    plan: Mapped["QualityInspectionPlan"] = relationship("QualityInspectionPlan", back_populates="lines")
    characteristic: Mapped["QualityCharacteristic"] = relationship("QualityCharacteristic")
