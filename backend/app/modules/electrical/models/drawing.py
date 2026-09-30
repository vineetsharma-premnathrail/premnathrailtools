from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, BigInteger, Boolean, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

ELECTRICAL_DRAWING_TYPES: dict[str, str] = {
    "schematic": "Electrical Schematic",
    "single_line": "Single Line Diagram",
    "wiring_diagram": "Wiring Diagram",
    "harness": "Harness Drawing",
    "panel_ga": "Panel GA",
    "panel_wiring": "Panel Wiring",
    "cable_schedule": "Cable Schedule",
    "layout": "Equipment Layout",
    "other": "Other",
}

# draft → submitted → approved | rejected. Approving a revision supersedes
# the drawing's previously approved one; a rejected revision is dead — the
# author raises the next revision instead of editing it.
ELECTRICAL_REVISION_STATUSES = ("draft", "submitted", "approved", "rejected", "superseded")
ELECTRICAL_OPEN_REVISION_STATUSES = ("draft", "submitted")


class ElectricalDrawing(Base, TimestampMixin, SoftDeleteMixin):
    """A controlled electrical drawing of one job. Identity only — files
    and approvals live on its revisions (R0, R1 …). `is_as_built` marks the
    drawings that make up the As-Built Electrical Records.

    Kept inside Electrical rather than on design_documents because the
    Design module isn't live yet; design_documents already carries a
    `discipline` column so these can be folded into it later."""

    __tablename__ = "electrical_drawings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("electrical_jobs.id"), index=True, nullable=False)
    drawing_number: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    drawing_type: Mapped[str] = mapped_column(String(30), default="schematic", nullable=False)
    is_as_built: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    revisions: Mapped[list["ElectricalDrawingRevision"]] = relationship(
        "ElectricalDrawingRevision", back_populates="drawing", order_by="ElectricalDrawingRevision.revision_index",
    )


class ElectricalDrawingRevision(Base, TimestampMixin, SoftDeleteMixin):
    """R0, R1, R2 … of a drawing, each with its own file in SharePoint
    (Electrical-media/<job number>/<drawing number>/). The approver must be
    someone other than the person who prepared it."""

    __tablename__ = "electrical_drawing_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    drawing_id: Mapped[int] = mapped_column(Integer, ForeignKey("electrical_drawings.id"), index=True, nullable=False)
    revision_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    revision_label: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    prepared_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    drawing: Mapped["ElectricalDrawing"] = relationship("ElectricalDrawing", back_populates="revisions")
