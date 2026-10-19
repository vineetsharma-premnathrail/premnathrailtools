from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, Boolean, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

QUALITY_CAPA_ACTION_TYPES = ("corrective", "preventive")

# 8D CAPA lifecycle (Phase 3):
#   open → root_cause_found (D1–D4 done) → actions_in_progress (D5 planned)
#   → effectiveness_check (D5/D6 done, D7 recorded; waits the settings
#   period) → closed (D8: effective) | reopened (not effective → back to D4).
# Legacy statuses in_progress / pending_verification / overdue were migrated
# to actions_in_progress / effectiveness_check / actions_in_progress.
QUALITY_CAPA_STATUSES = ("open", "root_cause_found", "actions_in_progress", "effectiveness_check", "closed", "reopened")
QUALITY_CAPA_OPEN_STATUSES = ("open", "root_cause_found", "actions_in_progress", "effectiveness_check", "reopened")
QUALITY_CAPA_STATUS_LABELS = {
    "open": "Open", "root_cause_found": "Root cause found", "actions_in_progress": "Actions in progress",
    "effectiveness_check": "Effectiveness check", "closed": "Closed", "reopened": "Reopened",
}

# What raised the CAPA. ncr = Major / Critical NCR; repeat_defect = the same
# defect code on the same item N times in M days (Quality → Settings);
# complaint = customer complaint; audit = audit finding (Phase 4 calls
# services.capa.raise_for_audit_finding); vendor_trend = supplier rating fell
# below the On-watch limit.
QUALITY_CAPA_TRIGGERS = ("manual", "ncr", "repeat_defect", "complaint", "audit", "vendor_trend")
QUALITY_CAPA_TRIGGER_LABELS = {
    "manual": "Raised manually", "ncr": "Major / Critical NCR", "repeat_defect": "Repeat defect",
    "complaint": "Customer complaint", "audit": "Audit finding", "vendor_trend": "Vendor rejection trend",
}

QUALITY_CAPA_ROOT_CAUSE_METHODS = ("why_why", "fishbone", "both")
# Fishbone (Ishikawa) 6M categories — coded, not configurable.
QUALITY_FISHBONE_CATEGORIES = ("man", "machine", "method", "material", "measurement", "environment")

# D5 corrective / D7 preventive action items.
QUALITY_CAPA_ITEM_KINDS = ("corrective", "preventive")
# D7 prevention: what system document the lesson is built into.
QUALITY_CAPA_PREVENTION_TYPES = (
    "update_inspection_plan", "update_drawing", "training", "update_procedure", "update_fmea", "other",
)
QUALITY_CAPA_PREVENTION_LABELS = {
    "update_inspection_plan": "Update inspection plan", "update_drawing": "Update drawing / specification",
    "training": "Training", "update_procedure": "Update work instruction / procedure", "update_fmea": "Update FMEA / control plan",
    "other": "Other",
}
QUALITY_CAPA_ITEM_STATUSES = ("open", "done", "cancelled")

QUALITY_CAPA_TEAM_ROLES = ("champion", "leader", "member")


class QualityCapa(Base, TimestampMixin, SoftDeleteMixin):
    """Corrective / preventive action in 8D form. D1 team (+ owner), D2
    problem (+ linked NCRs), D3 containment, D4 root cause (why-why /
    fishbone), D5 corrective actions and D7 prevention items (child rows,
    each with owner + due date), D6 implementation evidence (per action),
    D8 effectiveness check after the settings period, then closure."""

    __tablename__ = "quality_capas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    capa_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    action_type: Mapped[str] = mapped_column(String(20), default="corrective", nullable=False)
    trigger: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual", nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="major", server_default="major", nullable=False)
    # Primary source documents. Further NCRs link through quality_capa_ncrs.
    ncr_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_ncrs.id"), nullable=True)
    complaint_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("quality_customer_complaints.id"), nullable=True
    )
    # Audit finding (Phase 4) — free reference until audits exist.
    audit_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True, index=True)
    item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    defect_code_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_defect_codes.id"), nullable=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # D1 — owner (champion) responsible for driving the 8D.
    responsible_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # Target date for the whole CAPA (actions carry their own due dates).
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # D2 — problem description (what / where / when / how many / how found).
    problem_statement: Mapped[str | None] = mapped_column(Text, nullable=True)
    # D3 — containment (sort stock, hold dispatches, inform customer …).
    containment_actions: Mapped[str | None] = mapped_column(Text, nullable=True)
    containment_done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # D4 — root cause.
    root_cause_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    why_analysis: Mapped[list | None] = mapped_column(JSON, nullable=True)       # ["why 1", "why 2", …]
    fishbone: Mapped[dict | None] = mapped_column(JSON, nullable=True)           # {"man": ["…"], …}
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_cause_found_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Legacy free-text plan (pre-8D CAPAs); new CAPAs use action rows.
    action_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    # D6 — overall implementation summary (per-action evidence on the rows).
    implementation_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # D7 — reason when no prevention item is needed.
    prevention_not_needed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    actions_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # D8 — effectiveness check after the settings period.
    effectiveness_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    effectiveness_result: Mapped[str | None] = mapped_column(String(20), nullable=True)  # effective | not_effective
    effectiveness_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    effectiveness_checked_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    effectiveness_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    closure_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="open", nullable=False)
    reopen_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # 8D report revision — bumps on reopen, so the Word document of record
    # for the earlier closure stays as it was.
    report_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    team: Mapped[list["QualityCapaTeamMember"]] = relationship(
        "QualityCapaTeamMember", back_populates="capa", cascade="all, delete-orphan", order_by="QualityCapaTeamMember.id",
    )
    actions: Mapped[list["QualityCapaAction"]] = relationship(
        "QualityCapaAction", back_populates="capa", cascade="all, delete-orphan", order_by="QualityCapaAction.id",
    )
    ncr_links: Mapped[list["QualityCapaNcr"]] = relationship(
        "QualityCapaNcr", back_populates="capa", cascade="all, delete-orphan", order_by="QualityCapaNcr.id",
    )


class QualityCapaTeamMember(Base, TimestampMixin):
    """D1 — one member of the 8D team."""

    __tablename__ = "quality_capa_team"
    __table_args__ = (UniqueConstraint("capa_id", "user_id", name="uq_quality_capa_team_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    capa_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_capas.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="member", nullable=False)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)

    capa: Mapped["QualityCapa"] = relationship("QualityCapa", back_populates="team")


class QualityCapaNcr(Base, TimestampMixin):
    """D2 — an NCR covered by this CAPA (the repeat-defect trigger links
    every NCR in the window; later repeats link to the open CAPA)."""

    __tablename__ = "quality_capa_ncrs"
    __table_args__ = (UniqueConstraint("capa_id", "ncr_id", name="uq_quality_capa_ncr"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    capa_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_capas.id"), index=True, nullable=False)
    ncr_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_ncrs.id"), index=True, nullable=False)

    capa: Mapped["QualityCapa"] = relationship("QualityCapa", back_populates="ncr_links")


class QualityCapaAction(Base, TimestampMixin):
    """D5 corrective action / D7 preventive item with owner + due date. D6
    evidence (what was done, document reference) is recorded when it's
    marked done. Overdue open items remind the owner + Quality heads."""

    __tablename__ = "quality_capa_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    capa_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_capas.id"), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="corrective", nullable=False)
    prevention_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)
    # D6 — implementation evidence.
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    done_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # Superseded by a reopen: kept for history, no longer counted.
    superseded: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    capa: Mapped["QualityCapa"] = relationship("QualityCapa", back_populates="actions")
