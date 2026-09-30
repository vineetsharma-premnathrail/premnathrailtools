from __future__ import annotations
from sqlalchemy import String, Integer, BigInteger, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

ELECTRICAL_DOCUMENT_CATEGORIES: dict[str, str] = {
    "requirement_spec": "Requirement / Customer Spec",
    "design_calculation": "Design Calculation",
    "datasheet": "Component Datasheet",
    "test_report": "Test Report",
    "inspection_report": "Inspection Report",
    "commissioning_report": "Commissioning Report",
    "manual": "O&M Manual",
    "handover_certificate": "Handover Certificate",
    "as_built_record": "As-Built Record",
    "photo": "Photo",
    "other": "Other",
}

# Final Electrical Documentation needs at least one of these on the job.
ELECTRICAL_FINAL_DOC_CATEGORIES = ("test_report", "commissioning_report", "manual")


class ElectricalDocument(Base, TimestampMixin, SoftDeleteMixin):
    """A file attached to a job — optionally to one of its stages. Bytes
    live in SharePoint; only the pointer and metadata live here, same
    pattern as RndDocument / QualityDocument. Drawings have their own
    revision-controlled register (ElectricalDrawing) instead."""

    __tablename__ = "electrical_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("electrical_jobs.id"), index=True, nullable=False)
    stage_key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    category: Mapped[str] = mapped_column(String(30), default="other", nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
