from __future__ import annotations
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class CrmDocument(Base, TimestampMixin, SoftDeleteMixin):
    """A file uploaded against an Inquiry/Tender, stored in SharePoint (only the
    pointer/metadata lives here — the actual bytes live in SharePoint)."""

    __tablename__ = "crm_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    related_module: Mapped[str] = mapped_column(String(30), nullable=False)
    related_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    related_sub_module: Mapped[str | None] = mapped_column(String(30), nullable=True)
    related_sub_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    universal_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    folder_type: Mapped[str] = mapped_column(String(20), nullable=False)
    doc_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    org_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
