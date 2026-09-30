from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

MAINTENANCE_ATTACHMENT_ENTITIES = ("asset", "request", "work_order")
MAINTENANCE_ATTACHMENT_DOC_TYPES = ("photo", "manual", "drawing", "service_report", "certificate", "other")


class MaintenanceAttachment(Base, TimestampMixin, SoftDeleteMixin):
    """One polymorphic attachment table for assets (manuals, drawings,
    photos), requests (breakdown photos) and work orders (service reports).
    Bytes live in SharePoint under Maintenance-media."""

    __tablename__ = "maintenance_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    doc_type: Mapped[str] = mapped_column(String(20), default="other", nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
