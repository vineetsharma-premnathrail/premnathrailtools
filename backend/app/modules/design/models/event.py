from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class DesignEvent(Base):
    """Human-readable workflow timeline + comment thread for a document
    (optionally a specific revision), a BOM, an ECR, an ECN, a customer
    submission or a design request. The field-level audit trail
    still comes from audit_logs underneath (core/audit_registry.py); this is
    the "who submitted / passed / returned it, and why" view the detail
    pages show. Append-only — never updated or deleted."""

    __tablename__ = "design_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_documents.id"), index=True, nullable=True)
    revision_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_document_revisions.id"), nullable=True)
    ecn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_change_notices.id"), index=True, nullable=True)
    bom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_boms.id"), index=True, nullable=True)
    bom_revision_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_bom_revisions.id"), nullable=True)
    ecr_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_change_requests.id"), index=True, nullable=True)
    submission_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_customer_submissions.id"), index=True, nullable=True)
    request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_requests.id"), index=True, nullable=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
