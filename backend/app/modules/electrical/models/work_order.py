from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Text, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.erp.models.project import Project

# open -> assigned -> in_progress -> testing -> resolved -> closed
# See docs/product/ELECTRICAL_MODULE_PLAN.md Phase 1.
ELECTRICAL_WORK_ORDER_STATUSES = ("open", "assigned", "in_progress", "testing", "resolved", "closed")
ELECTRICAL_WORK_ORDER_PRIORITIES = ("low", "medium", "high", "critical")


class ElectricalWorkOrder(Base, TimestampMixin):
    __tablename__ = "electrical_work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_order_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=False)

    equipment_tag: Mapped[str | None] = mapped_column(String(100), nullable=True)
    voltage_system: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fault_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Optional — a work order can originate from an ERP Service Request
    # (e.g. electrical fault reported during a service visit) without
    # importing ERP route/service code — id-reference only.
    source_service_request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_service_requests.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)
    priority: Mapped[str] = mapped_column(String(10), default="medium", nullable=False)

    assigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    raised_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    expected_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped["Project"] = relationship("Project")
