from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, JSON, String, Text,
    UniqueConstraint, func, text,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class LibraryFolder(Base, TimestampMixin, SoftDeleteMixin):
    """Sales Library folder (nested). parent_id NULL = root folder."""

    __tablename__ = "crm_library_folders"
    __table_args__ = (
        # Folder names are unique among live siblings, case-insensitive (roots share parent 0).
        Index(
            "uq_crm_library_folders_parent_name_live",
            text("coalesce(parent_id, 0)"),
            text("lower(name)"),
            unique=True,
            postgresql_where=text("is_deleted = false"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("crm_library_folders.id", ondelete="RESTRICT"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Files uploaded into this folder auto-link this product.
    product_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
    is_confidential: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Documents inside a pricing folder must carry an expiry date.
    is_pricing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class LibraryDocument(Base, TimestampMixin, SoftDeleteMixin):
    """A library document. The bytes live in SharePoint, one row per version in LibraryDocumentVersion."""

    __tablename__ = "crm_library_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    folder_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crm_library_folders.id", ondelete="RESTRICT"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # pdf / video / image / spreadsheet / document / presentation / other
    file_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default=text("'[]'"))
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    current_version_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)


class LibraryDocumentVersion(Base, TimestampMixin):
    __tablename__ = "crm_library_document_versions"
    __table_args__ = (
        UniqueConstraint("document_id", "version_no", name="uq_crm_library_versions_doc_no"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crm_library_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sharepoint_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class LibraryDocumentLink(Base, TimestampMixin):
    """One document, many links (never copies). link_type in product / project / organization;
    link_id = products.id / pm_projects.id / crm_organizations.id (checked in the route, no polymorphic FK)."""

    __tablename__ = "crm_library_document_links"
    __table_args__ = (
        UniqueConstraint("document_id", "link_type", "link_id", name="uq_crm_library_links_doc_type_id"),
        Index("ix_crm_library_links_type_id", "link_type", "link_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crm_library_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    link_type: Mapped[str] = mapped_column(String(20), nullable=False)
    link_id: Mapped[int] = mapped_column(Integer, nullable=False)


class LibraryFavorite(Base):
    __tablename__ = "crm_library_favorites"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    document_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crm_library_documents.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
