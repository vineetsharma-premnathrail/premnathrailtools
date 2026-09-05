from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.erp.models.service_request import ServiceRequest
    from app.modules.erp.models.service_material_attachment import ServiceMaterialAttachment


class ServiceMaterial(Base, TimestampMixin, SoftDeleteMixin):
    """A spare-part / material line item attached to a Service Request."""

    __tablename__ = "erp_service_materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    service_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_service_requests.id"), nullable=False)
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    estimated_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1)
    unit: Mapped[str] = mapped_column(String(20), default="pcs")
    is_warranty_covered: Mapped[bool] = mapped_column(Boolean, default=False)
    phase: Mapped[str] = mapped_column(String(20), default="expected")
    status: Mapped[str | None] = mapped_column(String(50), default="pending", nullable=True)

    # Purchase Requisition linkage. `pr_id` is the only hard foreign key into
    # the `p2p` module; `pr_number`/`pr_status` are a denormalized mirror of
    # the P2PRequest so this row can display PR state without a cross-module
    # join. `pr_status` is a read-only mirror of P2PRequest.status, refreshed
    # whenever a material is marked received (see receive_material in
    # erp/routes/service_requests.py) — ERP never writes back to P2P itself.
    pr_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=True)
    pr_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pr_status: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Physical receipt at the service site, marked by the service user (not
    # Purchase) since they're the ones who can see the goods arrive.
    received_quantity: Mapped[float] = mapped_column(Float, default=0)
    receiving_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | partial | received

    service_request: Mapped["ServiceRequest"] = relationship("ServiceRequest", back_populates="materials")
    attachments: Mapped[list["ServiceMaterialAttachment"]] = relationship(
        "ServiceMaterialAttachment", back_populates="material", cascade="all, delete-orphan"
    )
