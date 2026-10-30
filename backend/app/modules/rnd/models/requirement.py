"""R&D intake: the formal record of a CRM requirement (Inquiry / Tender) that BD
sent to R&D with "Send Technical Requirement to R&D".

One RndRequirement per (source, record_id) carries the R&D ID (RDR-YYYY-NNNN).
Every send / re-send adds an RndRequirementRevision (R0, R1, ...) that holds the
review state: submitted -> accepted | returned -> responded, or superseded when
BD re-sends before R&D answered. The CRM record stays the single source of truth
for what was asked; the revision only points at the audit-log snapshot of that
send (movement_log_id) and caches the changed field labels.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

RND_REQUIREMENT_SOURCES = ("inquiry", "tender")
# Requirement status mirrors the latest revision's status.
RND_REQUIREMENT_STATUSES = ("submitted", "accepted", "returned", "responded")
RND_REVISION_STATUSES = ("submitted", "accepted", "returned", "responded", "superseded")


class RndRequirement(Base, TimestampMixin):
    """Header of one requirement in R&D: the R&D ID and the current state."""

    __tablename__ = "rnd_requirements"
    __table_args__ = (
        UniqueConstraint("rd_number", name="uq_rnd_requirement_number"),
        UniqueConstraint("source", "record_id", name="uq_rnd_requirement_source_record"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rd_number: Mapped[str] = mapped_column(String(20), nullable=False)  # RDR-2026-0001
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # "inquiry" | "tender"
    record_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted", server_default="submitted", index=True)
    current_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    first_received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RndRequirementRevision(Base):
    """One send of the requirement (R0 first). Carries the review decision."""

    __tablename__ = "rnd_requirement_revisions"
    __table_args__ = (
        UniqueConstraint("requirement_id", "revision_no", name="uq_rnd_requirement_revision_no"),
        UniqueConstraint("revision_code", name="uq_rnd_requirement_revision_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    requirement_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("rnd_requirements.id", ondelete="CASCADE"), nullable=False, index=True)
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    revision_code: Mapped[str] = mapped_column(String(30), nullable=False)  # RDR-2026-0001-R0
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted", server_default="submitted")
    crm_rnd_request_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("crm_rnd_requests.id", ondelete="SET NULL"), nullable=True, index=True)
    # The AuditLog row of this send: the snapshot of what BD sent (not copied here).
    movement_log_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("audit_logs.id", ondelete="SET NULL"), nullable=True)
    changed_fields: Mapped[Any] = mapped_column(JSON, nullable=True)  # cache of the changed field labels
    submitted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reviewed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    return_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Teams reminder cadence for a revision nobody has reviewed yet.
    last_reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
