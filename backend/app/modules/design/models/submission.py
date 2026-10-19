from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, BigInteger, Text, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# draft → sent (waiting on customer) → closed (every line has a response).
# cancelled = withdrawn before the customer answered.
DESIGN_SUBMISSION_STATUSES = ("draft", "sent", "closed", "cancelled")
# Per drawing. approved_with_comments lets the revision be released (the
# comments are tracked as actions for the next revision); rejected freezes
# the revision as customer_rejected.
DESIGN_CUSTOMER_RESPONSES = ("pending", "approved", "approved_with_comments", "rejected")
DESIGN_COMMENT_STATUSES = ("open", "done")


class DesignCustomerSubmission(Base, TimestampMixin, SoftDeleteMixin):
    """A transmittal of drawing revisions to a customer for approval."""

    __tablename__ = "design_customer_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), index=True, nullable=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pm_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pm_projects.id"), index=True, nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=True)
    cover_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    sent_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    response_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    response_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    response_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The customer's approval/comment letter (SharePoint).
    letter_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    letter_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    letter_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    sent_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    recorded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    lines: Mapped[list["DesignSubmissionLine"]] = relationship(
        "DesignSubmissionLine", back_populates="submission", cascade="all, delete-orphan",
        order_by="DesignSubmissionLine.id",
    )


class DesignSubmissionLine(Base, TimestampMixin):
    """One drawing revision on a submission and the customer's verdict on it."""

    __tablename__ = "design_submission_lines"
    __table_args__ = (UniqueConstraint("submission_id", "revision_id", name="uq_design_submission_revision"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_customer_submissions.id", ondelete="CASCADE"), index=True, nullable=False)
    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_documents.id"), index=True, nullable=False)
    revision_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_document_revisions.id"), index=True, nullable=False)
    response: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)
    response_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    submission: Mapped["DesignCustomerSubmission"] = relationship("DesignCustomerSubmission", back_populates="lines")


class DesignSubmissionComment(Base, TimestampMixin):
    """A customer comment turned into an action for a designer."""

    __tablename__ = "design_submission_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(Integer, ForeignKey("design_customer_submissions.id"), index=True, nullable=False)
    document_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_documents.id"), index=True, nullable=True)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    assigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="open", nullable=False)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
