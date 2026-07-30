from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.purchase.models.purchase_requisition_item import PurchaseRequisitionItem

# Lifecycle of a Purchase Requisition (PR), raised from a Service Request's
# Materials tab and processed to completion by the Purchase department.
#
#   submitted -> approved -> po_raised -> partially_received -> received -> closed
#            \-> rejected            \-> cancelled
#
# "partially_received"/"received" are computed automatically as materials are
# marked received on the Service Request side (see service_requests.py's
# receive_material endpoint) — nothing sets them directly via the API.
# "closed" is always an explicit action, only allowed once "received".
PR_STATUSES = (
    "submitted", "approved", "po_raised",
    "partially_received", "received", "closed",
    "rejected", "cancelled",
)


class PurchaseRequisition(Base, TimestampMixin):
    """A purchase requisition raised against a Service Request's materials list.

    This module is deliberately kept loosely coupled to `erp`: it only ever
    references `project_id`/`service_request_id` by id, never imports ERP
    route/service code, and the only two-way link into ERP is the small
    denormalized `pr_number`/`pr_status` mirror written onto `ServiceMaterial`
    (see `_sync_material_pr_fields` in routes/purchase_requisitions.py). That
    boundary is what would become a real HTTP/webhook call if this module is
    ever split out into its own deployable application.
    """

    __tablename__ = "purchase_requisitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pr_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)

    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=False, index=True)
    service_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_service_requests.id"), nullable=False, index=True)

    status: Mapped[str] = mapped_column(String(30), default="submitted", nullable=False)

    raised_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    po_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expected_delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["PurchaseRequisitionItem"]] = relationship(
        "PurchaseRequisitionItem", back_populates="purchase_requisition", cascade="all, delete-orphan"
    )
