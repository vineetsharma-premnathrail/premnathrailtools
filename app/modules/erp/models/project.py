from __future__ import annotations
from datetime import date
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Boolean, Date, Text
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

    service_requests: Mapped[list["ServiceRequest"]] = relationship(
        "ServiceRequest", back_populates="project", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["ProjectAttachment"]] = relationship(
        "ProjectAttachment", back_populates="project", cascade="all, delete-orphan"
    )
