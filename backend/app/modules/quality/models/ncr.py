from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# Where the non-conformance was found. Values are seeded into the
# "ncr_sources" master list (Quality → Settings); auto-raised NCRs use the
# lot's inspection type. "inspection"/"internal" are legacy values.
QUALITY_NCR_SOURCES = (
    "incoming", "job_work", "in_process", "final", "customer_inspection", "complaint", "audit",
    "internal", "inspection",
)
QUALITY_NCR_SEVERITIES = ("minor", "major", "critical")

# Open → Disposition decided → Action done → Verified → Closed (+ cancelled).
# The disposition is proposed and approved while the NCR is still "open"
# (disposition_status tracks that sub-step). Legacy statuses under_review /
# capa_assigned were migrated to open, rejected to cancelled.
QUALITY_NCR_STATUSES = ("open", "disposition_decided", "action_done", "verified", "closed", "cancelled")
QUALITY_NCR_OPEN_STATUSES = ("open", "disposition_decided", "action_done", "verified")

QUALITY_NCR_DISPOSITION_STATUSES = ("none", "pending_approval", "approved")

# Approval roles an NCR disposition may need (see services/ncr.py
# required_approval_roles for which disposition needs which).
QUALITY_NCR_APPROVAL_ROLES = ("quality_engineer", "quality_head", "design", "purchase", "partner")
QUALITY_NCR_APPROVAL_ROLE_LABELS = {
    "quality_engineer": "Quality engineer", "quality_head": "Quality head", "design": "Design",
    "purchase": "Purchase", "partner": "Partner",
}


class QualityNcr(Base, TimestampMixin, SoftDeleteMixin):
    """Non-Conformance Report. Raised automatically for rejected quantity /
    deviations at a lot usage decision, or manually. Holds the material in
    BLOCKED stock until the disposition is approved and executed."""

    __tablename__ = "quality_ncrs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ncr_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="minor", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)
    auto_raised: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    # Source documents. inspection_id = legacy inspection record.
    inspection_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspections.id"), nullable=True)
    lot_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspection_lots.id"), nullable=True, index=True)
    source_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)

    item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True, index=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Store whose BLOCKED stock holds `quantity`. NULL = no stock behind the
    # NCR (e.g. a documentation non-conformance) — dispositions then post
    # nothing.
    location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)
    stock_blocked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    defect_code_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_defect_codes.id"), nullable=True)

    description: Mapped[str] = mapped_column(Text, nullable=False)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    raised_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    ncr_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Disposition (proposed → approved by the required authorities).
    disposition_code_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_disposition_codes.id"), nullable=True)
    disposition_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    disposition_status: Mapped[str] = mapped_column(String(20), default="none", server_default="none", nullable=False)
    disposition_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_approval_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    customer_approval_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    disposition_proposed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    disposition_proposed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disposition_decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Material value at standard / average cost — decides whether scrap
    # needs Partner approval (Quality → Settings → scrap value limit).
    estimated_value: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Execution of the disposition (RTV / debit note / scrap note / rework order no.).
    action_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    action_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_done_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    action_done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reinspection_lot_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspection_lots.id"), nullable=True)
    verified_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Cost of non-quality (₹), entered before closure.
    material_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    rework_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    other_cost: Mapped[float | None] = mapped_column(Float, nullable=True)

    closed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    approvals: Mapped[list["QualityNcrApproval"]] = relationship(
        "QualityNcrApproval", back_populates="ncr", cascade="all, delete-orphan", order_by="QualityNcrApproval.id",
    )


class QualityNcrApproval(Base, TimestampMixin):
    """One authority's sign-off on an NCR's proposed disposition. A new
    proposal supersedes earlier rows (superseded=true) instead of deleting
    them, so the approval history stays complete."""

    __tablename__ = "quality_ncr_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ncr_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_ncrs.id"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    decision: Mapped[str] = mapped_column(String(10), nullable=False)  # approved | rejected
    disposition_type: Mapped[str] = mapped_column(String(30), nullable=False)
    approved_by_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    superseded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    ncr: Mapped["QualityNcr"] = relationship("QualityNcr", back_populates="approvals")
