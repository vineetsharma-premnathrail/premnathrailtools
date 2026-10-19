from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin
from app.modules.design.models.setting import JSONList

DESIGN_ECR_SOURCES = ("ncr", "capa", "customer", "production", "purchase", "quality", "service", "design", "other")
DESIGN_ECR_URGENCIES = ("low", "normal", "high", "critical")
# open → impact_checked (Design records the where-used impact) → the
# change board votes → the chair decides approved / rejected / deferred.
# A deferred ECR can be reopened; withdrawn = the raiser pulled it back.
DESIGN_ECR_STATUSES = ("open", "impact_checked", "approved", "rejected", "deferred", "withdrawn")
DESIGN_ECR_VOTES = ("approve", "reject", "defer")


class DesignChangeRequest(Base, TimestampMixin, SoftDeleteMixin):
    """Engineering Change Request — anyone asks for a change to released
    drawings/BOMs; the change board decides. Only an approved ECR can become
    an ECN (the instruction to implement)."""

    __tablename__ = "design_change_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ecr_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="design", nullable=False)
    quality_ncr_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_ncrs.id"), nullable=True)
    quality_capa_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_capas.id"), nullable=True)
    source_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    urgency: Mapped[str] = mapped_column(String(20), default="normal", nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_change: Mapped[str] = mapped_column(Text, nullable=False)
    pm_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pm_projects.id"), nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=True)

    # Impact check (Design fills in, helped by the where-used list).
    impact_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    impact_stock: Mapped[str | None] = mapped_column(Text, nullable=True)
    impact_open_orders: Mapped[str | None] = mapped_column(Text, nullable=True)
    impact_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    impact_delivery_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    impact_checked_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    impact_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="open", index=True, nullable=False)
    # Board members asked to vote on this ECR (copied from Settings at impact
    # check; the chair may add Purchase when material changes).
    board_member_ids: Mapped[list[int] | None] = mapped_column(
        JSONList, nullable=True, default=list)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    raised_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)

    items: Mapped[list["DesignChangeRequestItem"]] = relationship(
        "DesignChangeRequestItem", back_populates="ecr", cascade="all, delete-orphan",
        order_by="DesignChangeRequestItem.id",
    )
    votes: Mapped[list["DesignEcrVote"]] = relationship(
        "DesignEcrVote", back_populates="ecr", cascade="all, delete-orphan", order_by="DesignEcrVote.id",
    )


class DesignChangeRequestItem(Base, TimestampMixin):
    """An affected drawing or BOM (exactly one of document_id / bom_id)."""

    __tablename__ = "design_change_request_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ecr_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_change_requests.id", ondelete="CASCADE"), index=True, nullable=False)
    document_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_documents.id"), index=True, nullable=True)
    bom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_boms.id"), index=True, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    ecr: Mapped["DesignChangeRequest"] = relationship("DesignChangeRequest", back_populates="items")


class DesignEcrVote(Base, TimestampMixin):
    __tablename__ = "design_ecr_votes"
    __table_args__ = (UniqueConstraint("ecr_id", "user_id", name="uq_design_ecr_vote_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ecr_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_change_requests.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    vote: Mapped[str] = mapped_column(String(10), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    ecr: Mapped["DesignChangeRequest"] = relationship("DesignChangeRequest", back_populates="votes")
