from __future__ import annotations
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

RND_DOCUMENT_TYPES = ("specification", "drawing", "test_report", "research_note", "process_document", "other")

# Document categories (2026-10-30), shared by requirement documents
# (rnd_requirement_doc_visibility.category) and project documents (rnd_documents.category).
# "technical_offer" is set by the system only and is not offered in the upload picker.
RND_DOC_CATEGORIES = (
    "customer_specification", "technical_specification", "reference_standard", "drawing",
    "calculation", "test_report", "datasheet", "technical_offer", "other",
)
RND_DOC_CATEGORY_LABELS = {
    "customer_specification": "Customer Specification",
    "technical_specification": "Technical Specification",
    "reference_standard": "Reference Standard",
    "drawing": "Drawing",
    "calculation": "Calculation",
    "test_report": "Test Report",
    "datasheet": "Datasheet",
    "technical_offer": "Technical Offer",
    "other": "Other",
}
# Categories a user may pick when uploading (technical_offer is system-only).
RND_DOC_PICKER_CATEGORIES = tuple(c for c in RND_DOC_CATEGORIES if c != "technical_offer")


class RndDocument(Base, TimestampMixin, SoftDeleteMixin):
    """A file attached to an R&D project — optionally narrowed to one of its
    experiments or prototypes. Bytes live in SharePoint; only the pointer and
    metadata live here, same pattern as QualityDocument / CrmDocument."""

    __tablename__ = "rnd_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_projects.id"), index=True, nullable=False)
    experiment_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_experiments.id"), index=True, nullable=True)
    prototype_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_prototypes.id"), index=True, nullable=True)
    # Set when the file belongs to a project task (project_tasks.py): "brief"
    # = the lead's files, "work" = the assignee's. Task files stay out of the
    # project's Attachments list.
    task_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_project_tasks.id"), index=True, nullable=True)
    task_doc_role: Mapped[str | None] = mapped_column(String(10), nullable=True)
    doc_type: Mapped[str] = mapped_column(String(30), default="other", nullable=False)
    # RND_DOC_CATEGORIES; NULL on files saved before categories existed (the migration back-fills from doc_type).
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
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
