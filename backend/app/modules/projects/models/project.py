from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Text, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.projects.models.element import PmProjectElement

# Planning → Active → On hold ↔ Active → Technically complete (every
# milestone achieved, machine handed over) → Closed (after final billing and
# settlement). Cancelled is the exit from any open state. Status only changes
# through POST /projects/{id}/transition, never a plain PATCH.
PM_PROJECT_STATUSES = ("planning", "active", "on_hold", "technically_complete", "closed", "cancelled")
PM_PROJECT_PRIORITIES = ("low", "medium", "high", "critical")


class PmProject(Base, TimestampMixin):
    """One customer order (e.g. PEW-39) tracked from creation to handover and
    closure. Not to be confused with `app.modules.erp.models.project.Project`
    (table `erp_projects`, the machine registry used by Service)."""

    __tablename__ = "pm_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Typed by management — the ID every department knows the order by (PEW-39).
    project_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Free-text customer order / PO number. Not linked to CRM or Sales yet.
    customer_po_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sales_order_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_handover_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="planning", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    released_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Why the project is on hold — shown to every department.
    hold_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    closure_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Settlement note entered at closure (final invoice, retention released, ...).
    closure_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set when every WBS is accepted (status → Technically complete).
    technically_completed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Closure checklist: the PM confirms every project document is filed
    # (Documents tab / SharePoint) when closing — who and when are kept.
    documents_archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    documents_archived_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # What went well / what to do differently — goes into the Final Project Report.
    lessons_learned: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The Finance budget (internal order) the project's spend is tracked against;
    # one budget belongs to one project (accounts/services/project_budget.py).
    internal_order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("internal_orders.id", ondelete="SET NULL"), nullable=True, unique=True)
    # Set when the project was created from a confirmed sales order (one order = one project).
    sales_order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("sales_orders.id"), nullable=True, unique=True)
    customer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("crm_organizations.id"), nullable=True, index=True)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    # Where the machine/order is in its life (projects/lifecycle.py LIFECYCLE_STAGES);
    # separate from `status`, which keeps hold / cancel / close / release.
    lifecycle_stage: Mapped[str] = mapped_column(String(30), default="planned", server_default="planned", nullable=False)

    # Units (vehicles / lots) of a project made from a sales order.
    elements: Mapped[list["PmProjectElement"]] = relationship(
        "PmProjectElement", back_populates="project", cascade="all, delete-orphan",
        order_by="PmProjectElement.id",
    )
