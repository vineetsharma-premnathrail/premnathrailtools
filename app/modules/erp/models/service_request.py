from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Boolean, Date, DateTime, Text, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.erp.models.project import Project
    from app.modules.erp.models.service_material import ServiceMaterial
    from app.modules.erp.models.service_request_attachment import ServiceRequestAttachment


class ServiceRequest(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "erp_service_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)

    # Project link
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=False, index=True)

    # Issue details
    issue_title: Mapped[str] = mapped_column(String(300), nullable=False)
    issue_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    issue_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sub_category: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Status & priority
    status: Mapped[str] = mapped_column(String(50), default="open", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)

    # Root cause
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    failure_mode: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Warranty
    warranty_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    warranty_claim_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    warranty_claim_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    warranty_approved_amount: Mapped[float | None] = mapped_column(Float, nullable=True)

    # SLA (schema parity with legacy — legacy itself never wires these into any UI or API route)
    sla_response_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_resolution_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_response_met: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    sla_resolution_met: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Reported by (client contact)
    reported_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reported_by_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reported_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Assignment
    assigned_service_person_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    assigned_to_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expected_date_to_attend: Mapped[date | None] = mapped_column(Date, nullable=True)
    expected_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Execution
    actual_date_attended: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_service_duration_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    downtime_hours: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Resolution
    resolution_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    service_report_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    preventive_actions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Customer sign-off
    customer_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_satisfaction: Mapped[int | None] = mapped_column(Integer, nullable=True)
    customer_sign_off_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_sign_off_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Financial
    service_cost: Mapped[float] = mapped_column(Float, default=0)
    transport_cost: Mapped[float] = mapped_column(Float, default=0)
    accommodation_cost: Mapped[float] = mapped_column(Float, default=0)
    miscellaneous_cost: Mapped[float] = mapped_column(Float, default=0)
    total_material_cost: Mapped[float] = mapped_column(Float, default=0)
    tax_percentage: Mapped[float] = mapped_column(Float, default=18.0)
    tax_amount: Mapped[float] = mapped_column(Float, default=0)
    total_bill: Mapped[float] = mapped_column(Float, default=0)

    # Payment
    payment_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Lock (reserved for a future workflow-lock feature — nothing sets is_locked=True yet)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    locked_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lock_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Idempotency guards — ensure the "created"/"closed" team+client email notification
    # is ever sent at most once per SR, even if the background task path is triggered more than once.
    created_notification_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    closed_notification_sent: Mapped[bool] = mapped_column(Boolean, default=False)

    project: Mapped["Project"] = relationship("Project", back_populates="service_requests")
    materials: Mapped[list["ServiceMaterial"]] = relationship(
        "ServiceMaterial", back_populates="service_request", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["ServiceRequestAttachment"]] = relationship(
        "ServiceRequestAttachment", back_populates="service_request", cascade="all, delete-orphan"
    )
