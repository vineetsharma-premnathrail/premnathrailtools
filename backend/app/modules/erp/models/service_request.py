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


SR_PRIORITIES = ("standard", "urgent")
# Why the visit happens — drives who pays (warranty/AMC = no charge, paid_service = billable).
SR_SERVICE_TYPES = (
    "installation_commissioning",
    "warranty",
    "amc",
    "repair_breakdown",
    "inspection_maintenance",
    "paid_service",
)
# Machine cover on the SR's reported date (erp/warranty.py).
SR_WARRANTY_STATUSES = ("in_warranty", "extended_warranty", "amc", "out_of_warranty", "unknown")
# not_billable: free job · to_bill: chargeable, no live invoice yet ·
# invoiced: draft/posted AR invoice exists · paid: invoice fully collected.
SR_BILLING_STATUSES = ("not_billable", "to_bill", "invoiced", "paid")


class ServiceRequest(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "erp_service_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    # Number the SR had in the old system, set only by bulk import — the
    # duplicate key that stops one legacy SR being imported twice.
    legacy_sr_number: Mapped[str | None] = mapped_column(String(100), unique=True, index=True, nullable=True)

    # Project link
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=False, index=True)

    # Issue details
    issue_title: Mapped[str] = mapped_column(Text, nullable=False)
    issue_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    issue_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    service_type: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)  # SR_SERVICE_TYPES; null only on pre-existing SRs
    sub_category: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Status & priority
    status: Mapped[str] = mapped_column(String(50), default="open", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="standard", nullable=False)  # SR_PRIORITIES

    # Root cause
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    failure_mode: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Warranty
    warranty_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    warranty_claim_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    warranty_claim_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    warranty_approved_amount: Mapped[float | None] = mapped_column(Float, nullable=True)

    # SLA — set and computed by erp/sla.py (create, status changes, visits)
    sla_response_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_resolution_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_response_met: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    sla_resolution_met: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SLA clock (erp/sla.py): the coded profile applied at create (or a
    # contract's, when an AMC contract set the hours) and the due times.
    sla_profile: Mapped[str | None] = mapped_column(String(30), nullable=True)
    sla_response_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_resolution_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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

    # Payment — on SRs billed through Finance these two are a mirror of the
    # linked AR invoice (erp/billing.py sync_invoice), never typed by hand.
    payment_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Chargeability (SAP warranty check): `warranty_status` above is computed
    # from the machine (erp/warranty.py) when the SR is raised / edited;
    # `is_chargeable` defaults from it and the service type, and a different
    # choice needs `chargeable_reason` (kept in the audit trail).
    is_chargeable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    chargeable_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Service billing: the AR (sales) invoice raised for this SR, and the
    # actual cost of spares consumed (issue cost snapshot × net qty).
    ar_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ar_transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    billing_status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # SR_BILLING_STATUSES
    material_cost_actual: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    # Entitlement (VA41): the active AMC / CMC contract covering the machine on the reported
    # day — set by the warranty check (erp/contracts.py); covered work is free of charge.
    service_contract_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_service_contracts.id", ondelete="SET NULL"), nullable=True, index=True)

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

    # SLA clock states for the API (erp/sla.py): met · breached · at_risk ·
    # running · stopped · None (no SLA on the SR).
    @property
    def sla_response_state(self) -> str | None:
        from app.modules.erp.sla import response_state
        return response_state(self)

    @property
    def sla_resolution_state(self) -> str | None:
        from app.modules.erp.sla import resolution_state
        return resolution_state(self)
