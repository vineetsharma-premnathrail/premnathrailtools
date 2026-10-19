from __future__ import annotations
from datetime import date, datetime
from typing import Any
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, Boolean, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

RND_PROJECT_TYPES = ("new_product", "product_improvement", "process_development", "technology_research")
RND_PROJECT_PRIORITIES = ("low", "medium", "high", "critical")
# Lifecycle from the SAP mapping (Dept 4 R&D workflow): Initiation → Research
# → Development → Feasibility → Handover to Production → Closed.
RND_PROJECT_STAGES = ("initiation", "research", "development", "feasibility", "handover", "closed")
RND_PROJECT_STATUSES = ("active", "on_hold", "cancelled")

# Project origin — WHY the project exists (null on projects saved before it
# was recorded). project_type is kept in sync from it so older reports work.
RND_PROJECT_ORIGINS = ("customer_requirement", "product_improvement", "new_development", "process_research")
RND_ORIGIN_LABELS = {
    "customer_requirement": "Customer requirement",
    "product_improvement": "Improvement of existing product",
    "new_development": "New product (internal)",
    "process_research": "Process / technology research",
}
RND_ORIGIN_PROJECT_TYPE = {
    "customer_requirement": "new_product",
    "product_improvement": "product_improvement",
    "new_development": "new_product",
    "process_research": "technology_research",
}
# The record that proves the origin (source_kind + source_id).
RND_SOURCE_KINDS = ("inquiry", "tender", "quality_complaint", "ncr", "service_request")
RND_IMPROVEMENT_REASONS = ("customer_complaint", "ncr", "service_report", "cost_reduction", "production_difficulty")
RND_IMPROVEMENT_REASON_LABELS = {
    "customer_complaint": "Customer complaint",
    "ncr": "NCR (non-conformance)",
    "service_report": "Service report / field issue",
    "cost_reduction": "Cost reduction",
    "production_difficulty": "Production difficulty",
}
# Improvement reason → the record kind that must be linked as proof.
RND_REASON_SOURCE_KIND = {"customer_complaint": "quality_complaint", "ncr": "ncr", "service_report": "service_request"}


class RndProject(Base, TimestampMixin, SoftDeleteMixin):
    """An R&D project (SAP PS CJ20 equivalent) — the parent record every
    experiment, prototype, and the feasibility study hang off, ending in a
    formal handover to Production."""

    __tablename__ = "rnd_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    project_type: Mapped[str] = mapped_column(String(30), default="new_product", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)
    stage: Mapped[str] = mapped_column(String(20), default="initiation", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    objective: Mapped[str] = mapped_column(Text, nullable=False)
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)

    # A project can have several leads (lead_ids). lead_id mirrors the first
    # one so single-lead consumers (dashboard, data scope) keep working.
    lead_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    lead_ids: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    team_member_ids: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)

    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    budget_amount: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Handover-to-Production checklist — all four must be ticked before the
    # project can move to "closed" (see service.check_stage_gate).
    handover_specs_final: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    handover_bom_approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    handover_process_documented: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    handover_quality_standards: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    handover_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    handed_over_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Origin + source (see RND_PROJECT_ORIGINS). source_ref is a label snapshot
    # taken at link time so the Source card still reads if the record goes.
    origin: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    source_kind: Mapped[str | None] = mapped_column(String(30), nullable=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    improvement_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    origin_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
