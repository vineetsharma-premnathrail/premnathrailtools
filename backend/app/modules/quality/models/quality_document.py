from __future__ import annotations
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

QUALITY_DOCUMENT_TYPES = ("sop", "specification", "certificate", "standard_reference", "other")


class QualityDocument(Base, TimestampMixin, SoftDeleteMixin):
    """A quality-related file (SOP, specification, certificate, etc.), stored
    in SharePoint (only the pointer/metadata lives here — the actual bytes
    live in SharePoint), same pattern as CrmDocument."""

    __tablename__ = "quality_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    linked_standard_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_standards.id"), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
