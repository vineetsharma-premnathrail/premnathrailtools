from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.erp.models.service_request import ServiceRequest


class ServiceRequestAttachment(Base, TimestampMixin):
    """A file uploaded against a Service Request, stored in SharePoint (only the
    pointer/metadata lives here — the actual bytes live in SharePoint)."""

    __tablename__ = "erp_service_request_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    service_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_service_requests.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    service_request: Mapped["ServiceRequest"] = relationship("ServiceRequest", back_populates="attachments")
