from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Text, ForeignKey, Date, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class CrmRndRequest(Base, TimestampMixin):
    """The CRM ↔ R&D channel for one "Send Technical Requirement to R&D".

    CRM sets the date it's due and a remark; the request goes to the whole R&D
    team queue and any R&D user responds with remarks and/or documents.
    assigned_to_id is only set on older requests that named an engineer. Answering
    after the due date requires a delay reason, so slippage is explained at
    the moment it happens rather than reconstructed later.

    One row per send. A re-send supersedes the previous open row — R&D should
    answer the latest requirement, not an outdated one.
    """

    __tablename__ = "crm_rnd_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # "inquiry" | "tender"
    record_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # The AuditLog row written by requirement_movement.record_movement for this send.
    movement_log_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("audit_logs.id"), nullable=True, index=True)
    offer_number: Mapped[str | None] = mapped_column(String(50), nullable=True)

    assigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    crm_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # open → responded, open → closed (R&D closed it without a response; reason in response_remarks), or open → superseded (by a re-send); open → withdrawn (BD moved the record back before R&D started)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open")
    response_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    delay_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    responded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CrmRndRequestQuery(Base):
    """One question R&D put to BD about a requirement (Inquiry / Tender).

    The R&D request stays open while a question is open; the R&D clock is paused
    while `answer` is null (due_date_before / due_date_after keep the due date as it
    was when the question was asked and as it stands after BD answered).
    BD normally answers in the portal (`answer_channel` = 'portal'); when the answer
    came by 'phone', 'email' or 'meeting', whoever records it sets the channel and
    `answered_side` ('bd' = BD recorded it, 'rnd' = R&D recorded what BD told them).
    Older questions were only audit-log rows (action 'rnd_asked_details'); the
    migration copied them here with the answer left empty.
    """

    __tablename__ = "crm_rnd_request_queries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crm_rnd_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    asked_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    asked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    answer_channel: Mapped[str | None] = mapped_column(String(20), nullable=True)  # portal | phone | email | meeting
    answered_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    answered_side: Mapped[str | None] = mapped_column(String(10), nullable=True)  # bd | rnd
    due_date_before: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date_after: Mapped[date | None] = mapped_column(Date, nullable=True)
