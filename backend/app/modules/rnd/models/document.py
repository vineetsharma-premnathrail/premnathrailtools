from __future__ import annotations
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

RND_DOCUMENT_TYPES = ("specification", "drawing", "test_report", "research_note", "process_document", "other")


class RndDocument(Base, TimestampMixin, SoftDeleteMixin):
    """A file attached to an R&D project — optionally narrowed to one of its
    experiments or prototypes. Bytes live in SharePoint; only the pointer and
    metadata live here, same pattern as QualityDocument / CrmDocument."""

    __tablename__ = "rnd_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_projects.id"), index=True, nullable=False)
    experiment_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_experiments.id"), index=True, nullable=True)
    prototype_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_prototypes.id"), index=True, nullable=True)
    doc_type: Mapped[str] = mapped_column(String(30), default="other", nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
