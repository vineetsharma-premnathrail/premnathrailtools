from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Text, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

DESIGN_ECN_REASONS = (
    "design_improvement", "customer_request", "manufacturing_issue", "quality_issue",
    "cost_reduction", "safety", "regulatory", "other",
)
DESIGN_ECN_PRIORITIES = ("low", "medium", "high", "urgent")
# draft → submitted → approved → implemented; rejected / cancelled are final.
DESIGN_ECN_STATUSES = ("draft", "submitted", "approved", "rejected", "implemented", "cancelled")


class DesignChangeNotice(Base, TimestampMixin, SoftDeleteMixin):
    """Engineering Change Notice — the authorisation to change one or more
    released documents. Approval lets the affected documents' next revisions
    be raised under it; it can only be marked implemented once each of them
    has a released revision linked back to it."""

    __tablename__ = "design_change_notices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ecn_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    reason: Mapped[str] = mapped_column(String(30), default="design_improvement", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    impact_assessment: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    pm_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pm_projects.id"), nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approver_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    implemented_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    implemented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    documents: Mapped[list["DesignChangeNoticeDocument"]] = relationship(
        "DesignChangeNoticeDocument", back_populates="ecn", cascade="all, delete-orphan",
        order_by="DesignChangeNoticeDocument.id",
    )


class DesignChangeNoticeDocument(Base, TimestampMixin):
    """One affected document on an ECN, with what has to change in it."""

    __tablename__ = "design_change_notice_documents"
    __table_args__ = (UniqueConstraint("ecn_id", "document_id", name="uq_design_ecn_document"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ecn_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_change_notices.id"), index=True, nullable=False)
    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_documents.id"), index=True, nullable=False)
    change_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    ecn: Mapped["DesignChangeNotice"] = relationship("DesignChangeNotice", back_populates="documents")
