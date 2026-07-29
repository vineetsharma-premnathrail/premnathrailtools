from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.erp.models.service_request import ServiceRequest


class ServiceMaterial(Base, TimestampMixin, SoftDeleteMixin):
    """A spare-part / material line item attached to a Service Request."""

    __tablename__ = "erp_service_materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    service_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_service_requests.id"), nullable=False)
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1)
    unit: Mapped[str] = mapped_column(String(20), default="pcs")
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    total_price: Mapped[float] = mapped_column(Float, default=0)
    supplier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_warranty_covered: Mapped[bool] = mapped_column(Boolean, default=False)
    phase: Mapped[str] = mapped_column(String(20), default="expected")
    status: Mapped[str | None] = mapped_column(String(50), default="pending", nullable=True)
    availability: Mapped[str | None] = mapped_column(String(50), default="in_stock", nullable=True)

    service_request: Mapped["ServiceRequest"] = relationship("ServiceRequest", back_populates="materials")
