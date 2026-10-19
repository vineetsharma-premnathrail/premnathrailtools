from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, BigInteger, Boolean, Text, DateTime, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# document_type → number prefix. The prefix is baked into doc_number, which is
# why the type can't be changed after creation.
DESIGN_DOCUMENT_TYPES: dict[str, str] = {
    "ga_drawing": "GA",
    "part_drawing": "DWG",
    "assembly_drawing": "ASM",
    "schematic": "SCH",
    "specification": "SPC",
    "calculation": "CAL",
    "datasheet": "DS",
    "procedure": "PRC",
    "manual": "MAN",
    "bom": "BOM",
    # Discipline drawings (plan §8 item 1 / §33) — electrical, hydraulic,
    # pneumatic and panel work each get their own number series.
    "wiring_diagram": "WD",
    "harness_drawing": "HRN",
    "hydraulic_circuit": "HYC",
    "pneumatic_circuit": "PNC",
    "panel_layout": "PNL",
    "other": "DOC",
}
# Shared with Electrical/Hydraulic later — one table for every discipline,
# per old_docs/product/DESIGN_MODULE_PLAN.md, not one per department.
DESIGN_DISCIPLINES = (
    "mechanical", "electrical", "hydraulic", "pneumatic", "structural", "civil", "instrumentation", "general",
)
# Document-level lifecycle. Revision status (below) carries the workflow.
DESIGN_DOCUMENT_STATUSES = ("active", "obsolete")

# draft → in_review → in_approval → released → superseded. Returning a
# revision (checker or approver) or recalling it puts it back to draft.
# Documents flagged customer_approval_required stop at `approved` after the
# internal approval and are released only once a customer submission records
# the customer's approval; a customer rejection freezes the revision as
# `customer_rejected` (what the customer saw stays on record) and the fix
# goes out as the next revision.
DESIGN_REVISION_STATUSES = ("draft", "in_review", "in_approval", "approved", "released", "superseded", "customer_rejected")
DESIGN_OPEN_REVISION_STATUSES = ("draft", "in_review", "in_approval", "approved")

# primary = the controlled print (usually PDF), native = the CAD/Office
# source it was produced from, supporting = anything else (calcs, photos).
DESIGN_FILE_ROLES = ("primary", "native", "supporting")


class DesignDocument(Base, TimestampMixin, SoftDeleteMixin):
    """One controlled engineering document (drawing, spec, calculation…).
    The document itself only carries identity and associations — every
    file and every approval lives on its revisions, and at most one
    revision is `released` (the controlled one) at any time."""

    __tablename__ = "design_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    discipline: Mapped[str] = mapped_column(String(30), default="mechanical", index=True, nullable=False)

    pm_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pm_projects.id"), index=True, nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), index=True, nullable=True)
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=True)
    department_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("departments.id"), nullable=True)
    # Customer the drawing is made for (CRM organization), and whether that
    # customer/contract requires drawing approval before release.
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), index=True, nullable=True)
    customer_approval_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    standard_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_standards.id"), nullable=True)
    design_request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_requests.id"), index=True, nullable=True)
    # Number the drawing carried before it entered this register (migration
    # of existing drawings). The register number itself is always generated.
    legacy_number: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)

    owner_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="active", index=True, nullable=False)
    obsoleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    obsoleted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    obsolete_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    revisions: Mapped[list["DesignDocumentRevision"]] = relationship(
        "DesignDocumentRevision", back_populates="document",
        order_by="DesignDocumentRevision.revision_index",
    )


class DesignDocumentRevision(Base, TimestampMixin, SoftDeleteMixin):
    """R0, R1, R2… of a document. `created_by_id` is the author; the
    reviewer (checker) and approver are named at submission and must be two
    different people, neither of them the author. `reviewed_by_id` /
    `approved_by_id` record who actually decided (an admin can stand in)."""

    __tablename__ = "design_document_revisions"
    # Unique among live rows only, so a discarded draft R1 frees "R1" for
    # the next attempt instead of forcing the numbering to skip to R2.
    __table_args__ = (
        Index(
            "uq_design_revision_document_index", "document_id", "revision_index", unique=True,
            postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = 0"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_documents.id"), index=True, nullable=False)
    revision_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    revision_label: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    ecn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_change_notices.id"), index=True, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reviewer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    approver_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)

    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    returned_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Who released an `approved` (customer-approval) revision, if not the approver.
    released_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    document: Mapped["DesignDocument"] = relationship("DesignDocument", back_populates="revisions")
    files: Mapped[list["DesignRevisionFile"]] = relationship(
        "DesignRevisionFile", back_populates="revision", order_by="DesignRevisionFile.id",
    )


class DesignRevisionFile(Base, TimestampMixin, SoftDeleteMixin):
    """A file on one revision, stored in SharePoint under
    Design-media/<doc_number>/<revision_label>/. Only changeable while the
    revision is a draft — a released revision's files are the record."""

    __tablename__ = "design_revision_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    revision_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_document_revisions.id"), index=True, nullable=False)
    file_role: Mapped[str] = mapped_column(String(20), default="primary", nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    revision: Mapped["DesignDocumentRevision"] = relationship("DesignDocumentRevision", back_populates="files")
