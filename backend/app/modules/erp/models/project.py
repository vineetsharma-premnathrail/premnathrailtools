from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Boolean, Date, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.erp.models.service_request import ServiceRequest
    from app.modules.erp.models.project_attachment import ProjectAttachment


class Project(Base, TimestampMixin, SoftDeleteMixin):
    """A deployed machine/vehicle/asset that Service Requests are raised against."""

    __tablename__ = "erp_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Machine identity
    machine_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    serial_number: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    engine_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    chassis_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    application_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)

    # Purchase & delivery
    po_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Contract inspection requirement (Quality rule 8): when set, finished
    # goods for this order can't be dispatched until a customer / third-party
    # inspection call is accepted with its certificate. inspection_agency is
    # a Quality master value (RITES / RDSO / Customer / Other).
    third_party_inspection_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    inspection_agency: Mapped[str | None] = mapped_column(String(50), nullable=True)
    commissioning_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    handover_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Client
    client_company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_designation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    client_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    client_phone_alt: Mapped[str | None] = mapped_column(String(50), nullable=True)
    client_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_gst: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Installed base (SAP IE01/IB51): the CRM customer who owns the machine
    # and the finished product it is. The client_* text above is kept as the
    # display snapshot (and for legacy machines no customer could be matched
    # to); billing, GSTIN and place of supply come from the customer row.
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)

    # Site deployment
    site_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    site_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    site_state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    site_pincode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    site_country: Mapped[str | None] = mapped_column(String(100), default="India")
    zone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_export: Mapped[bool] = mapped_column(Boolean, default=False)

    # Warranty / AMC
    warranty_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    warranty_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    warranty_override: Mapped[str | None] = mapped_column(String(50), nullable=True)
    extended_warranty: Mapped[bool] = mapped_column(Boolean, default=False)
    extended_warranty_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    amc_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    amc_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Operator
    operator_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    operator_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    operator_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    operator_qualification: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Technical
    specifications: Mapped[str | None] = mapped_column(Text, nullable=True)
    installed_options: Mapped[str | None] = mapped_column(Text, nullable=True)
    software_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    year_of_manufacture: Mapped[str | None] = mapped_column(String(50), nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tech_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    warranty_terms: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Approval (Service → Settings "New machines need approval"). Existing and
    # Production-created machines are 'approved'; with the setting on, a machine
    # registered from Service starts 'pending' and can't take SRs until approved.
    approval_status: Mapped[str] = mapped_column(String(20), default="approved", server_default="approved", nullable=False)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    service_requests: Mapped[list["ServiceRequest"]] = relationship(
        "ServiceRequest", back_populates="project", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["ProjectAttachment"]] = relationship(
        "ProjectAttachment", back_populates="project", cascade="all, delete-orphan"
    )
    customer = relationship("Organization", foreign_keys=[customer_id], viewonly=True, lazy="select")
    product = relationship("FinishedProduct", foreign_keys=[product_id], viewonly=True, lazy="select")

    @property
    def customer_name(self) -> str | None:
        return self.customer.name if self.customer is not None else None

    @property
    def product_name(self) -> str | None:
        return self.product.name if self.product is not None else None
