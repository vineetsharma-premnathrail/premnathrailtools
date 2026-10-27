from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, DateTime, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# Same signature workflow as drawings: draft → in_review → in_approval →
# released → superseded.
DESIGN_BOM_REVISION_STATUSES = ("draft", "in_review", "in_approval", "released", "superseded")
DESIGN_BOM_OPEN_STATUSES = ("draft", "in_review", "in_approval")
DESIGN_MAKE_BUY = ("make", "buy")


class DesignBom(Base, TimestampMixin, SoftDeleteMixin):
    """Engineering BOM of one product/assembly (an Item Master code).

    Single-level by design: each line is a direct child. A line whose item
    has its own released BOM is a sub-assembly, so the multi-level tree is
    the explosion through those BOMs (standard ERP practice — one BOM per
    assembly, reused wherever the assembly is used). The BOM carries its own
    revision (B0, B1…) — not the drawing's — so a quantity or make change
    doesn't force a drawing revision; the ECN ties both together."""

    __tablename__ = "design_boms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # SM12 optimistic lock (core/optimistic_lock.py): bumped on every UPDATE;
    # a save carrying an older X-Lock-Version gets 409 "changed by X at T".
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    lock_changed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    __mapper_args__ = {"version_id_col": lock_version}
    bom_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    product_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The product's GA/assembly drawing.
    document_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_documents.id"), nullable=True)
    # Set for a customer project's BOM — the "project BOM" Store/Purchase
    # plan material against.
    pm_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pm_projects.id"), index=True, nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), index=True, nullable=True)
    # PM project (Project Management › All Projects) — the confirmed order this work is for;
    # element = one vehicle / lot of it. Nullable, kept when the project closes.
    order_project_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pm_projects.id", ondelete="SET NULL"), index=True, nullable=True)
    order_project_element_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pm_project_elements.id", ondelete="SET NULL"), index=True, nullable=True)
    design_request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_requests.id"), nullable=True)
    owner_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True, nullable=False)
    obsoleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    obsolete_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    revisions: Mapped[list["DesignBomRevision"]] = relationship(
        "DesignBomRevision", back_populates="bom", order_by="DesignBomRevision.revision_index",
    )


class DesignBomRevision(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "design_bom_revisions"
    __table_args__ = (
        Index(
            "uq_design_bom_revision_index", "bom_id", "revision_index", unique=True,
            postgresql_where=text("is_deleted = false"), sqlite_where=text("is_deleted = 0"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_boms.id"), index=True, nullable=False)
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

    bom: Mapped["DesignBom"] = relationship("DesignBom", back_populates="revisions")
    lines: Mapped[list["DesignBomLine"]] = relationship(
        "DesignBomLine", back_populates="revision", cascade="all, delete-orphan",
        order_by="DesignBomLine.position",
    )


class DesignBomLine(Base, TimestampMixin):
    """One child of the assembly. Until Store creates the item code, a line
    may carry only `new_item_name`/`new_item_spec` (a new-item request) —
    the BOM can't be released while any such line remains."""

    __tablename__ = "design_bom_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    revision_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_bom_revisions.id", ondelete="CASCADE"), index=True, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=True)
    new_item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    new_item_spec: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_item_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1, nullable=False)
    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    document_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_documents.id"), index=True, nullable=True)
    # Snapshot of the drawing revision in force when the BOM was released.
    document_revision_label: Mapped[str | None] = mapped_column(String(10), nullable=True)
    make_buy: Mapped[str] = mapped_column(String(10), default="buy", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    revision: Mapped["DesignBomRevision"] = relationship("DesignBomRevision", back_populates="lines")
