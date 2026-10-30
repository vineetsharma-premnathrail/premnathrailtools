from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Text, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# Where the work came from: BD (an inquiry/tender's technical requirement),
# a project milestone, R&D handing over a proven result, or internal.
DESIGN_REQUEST_SOURCES = ("bd", "project", "rnd", "internal")
DESIGN_REQUEST_PRIORITIES = ("standard", "urgent")
# open → accepted (head assigned a lead designer) → in_progress (first
# deliverable started) → completed; on_hold / cancelled with a reason.
DESIGN_REQUEST_STATUSES = ("open", "accepted", "in_progress", "on_hold", "completed", "cancelled")
DESIGN_REQUEST_ACTIVE_STATUSES = ("open", "accepted", "in_progress", "on_hold")


class DesignRequest(Base, TimestampMixin, SoftDeleteMixin):
    """Incoming design work. The technical requirement is revisable: each
    revision bumps `requirement_revision`, and the lead designer's
    `reviewed_revision` lags behind until they confirm they've read it —
    that gap is the "changed since your review" flag."""

    __tablename__ = "design_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="internal", nullable=False)
    # BD reference: CRM inquiry or tender (crm_source = "inquiry" | "tender").
    crm_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    crm_record_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    crm_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True)
    pm_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pm_projects.id"), index=True, nullable=True)
    pm_milestone_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pm_project_milestones.id"), index=True, nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=True)
    # PM project (Project Management › All Projects) — the confirmed order this work is for;
    # element = one vehicle / lot of it. Nullable, kept when the project closes.
    order_project_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pm_projects.id", ondelete="SET NULL"), index=True, nullable=True)
    order_project_element_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pm_project_elements.id", ondelete="SET NULL"), index=True, nullable=True)

    requirement: Mapped[str] = mapped_column(Text, nullable=False)
    requirement_revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    requirement_revised_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_revision: Mapped[int] = mapped_column(Integer, default=-1, nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    priority: Mapped[str] = mapped_column(String(20), default="standard", nullable=False)  # standard | urgent
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True, nullable=False)
    # Who the request is waiting on right now: "design" or "requester"
    # (e.g. Design asked BD for missing input).
    waiting_on: Mapped[str] = mapped_column(String(20), default="design", nullable=False)
    waiting_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    lead_designer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    requested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    close_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class DesignRequirementRevision(Base, TimestampMixin):
    """History of a request's requirement text — revision 0 is the original."""

    __tablename__ = "design_requirement_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_requests.id"), index=True, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    requirement: Mapped[str] = mapped_column(Text, nullable=False)
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    revised_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class DesignTaskDeliverable(Base, TimestampMixin):
    """Links a Project Management task (pm_project_tasks) to the drawing or
    BOM it produces. Lives on the Design side so the PM tables stay
    untouched; the task is "ready to close" once the deliverable is released."""

    __tablename__ = "design_task_deliverables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pm_task_id: Mapped[int] = mapped_column(Integer, ForeignKey("pm_project_tasks.id"), index=True, nullable=False)
    document_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_documents.id"), index=True, nullable=True)
    bom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_boms.id"), index=True, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
