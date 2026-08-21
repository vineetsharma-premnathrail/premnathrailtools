from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.erp.models.project import Project

# Shared document repository across Design/Electrical/Fluids/R&D — one table
# with a `discipline` column, not three parallel schemas. See
# docs/product/DESIGN_MODULE_PLAN.md and the reconciliation note in
# docs/product/ELECTRICAL_MODULE_PLAN.md.
DOCUMENT_DISCIPLINES = ("mechanical", "electrical", "fluids", "rnd")
DOCUMENT_TYPES = (
    "ga_drawing", "part_drawing", "bom", "ecn", "spec_sheet",
    "wiring_diagram", "panel_layout", "cable_schedule",
    "circuit_diagram", "datasheet", "test_certificate", "report",
)
DOCUMENT_STATUSES = ("draft", "under_review", "approved", "released", "superseded")


class EngineeringDocument(Base, TimestampMixin):
    __tablename__ = "engineering_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=False)
    discipline: Mapped[str] = mapped_column(String(20), nullable=False)
    document_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    superseded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("engineering_documents.id"), nullable=True)

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    project: Mapped["Project"] = relationship("Project")
