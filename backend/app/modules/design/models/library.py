from __future__ import annotations
from sqlalchemy import String, Integer, BigInteger, Boolean, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

DESIGN_STANDARD_BODIES = ("RDSO", "IS", "EN", "ISO", "IEC", "UIC", "DIN", "ASME", "customer", "internal", "other")
DESIGN_TEMPLATE_KINDS = ("title_block", "drawing_sheet", "bom_sheet", "specification", "transmittal", "ecn_notice", "other")
DESIGN_CHECK_RESULTS = ("ok", "not_ok", "na")
DESIGN_MAKE_STATUSES = ("approved", "provisional", "withdrawn")


class DesignStandard(Base, TimestampMixin, SoftDeleteMixin):
    """A standard the drawings are made to (RDSO spec, IS, EN, customer
    standard) with the version in force. Superseded versions stay as their
    own rows (is_current=False) because old drawings cite them."""

    __tablename__ = "design_standards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    body: Mapped[str] = mapped_column(String(20), nullable=False)
    code: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class DesignStandardPart(Base, TimestampMixin, SoftDeleteMixin):
    """A reusable part designers should pick before drawing a new one —
    an Item Master code plus (optionally) its controlled drawing."""

    __tablename__ = "design_standard_parts"
    __table_args__ = (UniqueConstraint("store_item_id", name="uq_design_standard_part_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    store_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=False)
    document_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_documents.id"), nullable=True)
    standard_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_standards.id"), nullable=True)
    discipline: Mapped[str] = mapped_column(String(30), default="mechanical", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class DesignTemplate(Base, TimestampMixin, SoftDeleteMixin):
    """Title block, drawing sheet, BOM sheet, transmittal, ECN notice
    templates — files designers download and use."""

    __tablename__ = "design_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sharepoint_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class DesignItemApprovedMake(Base, TimestampMixin):
    """Technically approved make/model for an Item Master code — Design's
    approved-makes list. Kept per item (not per BOM line) so every BOM using
    the item shows the same list and Purchase has one source to buy from."""

    __tablename__ = "design_item_approved_makes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    store_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    make: Mapped[str] = mapped_column(String(150), nullable=False)
    part_number: Mapped[str | None] = mapped_column(String(150), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="approved", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class DesignChecklist(Base, TimestampMixin, SoftDeleteMixin):
    """Review checklist for one document type (or `bom`), optionally one
    discipline. The checker must answer every item before passing."""

    __tablename__ = "design_checklists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    document_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    discipline: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    items: Mapped[list["DesignChecklistItem"]] = relationship(
        "DesignChecklistItem", back_populates="checklist", cascade="all, delete-orphan",
        order_by="DesignChecklistItem.sort_order",
    )


class DesignChecklistItem(Base, TimestampMixin):
    __tablename__ = "design_checklist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    checklist_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_checklists.id", ondelete="CASCADE"), index=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    text: Mapped[str] = mapped_column(String(500), nullable=False)

    checklist: Mapped["DesignChecklist"] = relationship("DesignChecklist", back_populates="items")


class DesignReviewResult(Base, TimestampMixin):
    """One checklist answer from one check of a revision (document or BOM).
    The item text is copied so later checklist edits don't rewrite history.
    `cycle` = the revision's returned_count at the time, so every
    submit → check round keeps its own answers."""

    __tablename__ = "design_review_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    revision_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_document_revisions.id"), index=True, nullable=True)
    bom_revision_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_bom_revisions.id"), index=True, nullable=True)
    cycle: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    checklist_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_checklist_items.id", ondelete="SET NULL"), nullable=True)
    item_text: Mapped[str] = mapped_column(String(500), nullable=False)
    result: Mapped[str] = mapped_column(String(10), nullable=False)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
