from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# Customer engagement (2026-10-27): a logged touchpoint with a customer organization
# that is not (yet) an inquiry — a meeting, call, visit or general discussion — and
# what came out of it. "Inquiry required" is the hand-off to Inquiries & Tenders.
ENGAGEMENT_TYPES = ("meeting", "call", "visit", "general_discussion")
ENGAGEMENT_TYPE_LABELS = {"meeting": "Meeting", "call": "Call", "visit": "Visit", "general_discussion": "General Discussion"}
ENGAGEMENT_OUTCOMES = ("no_requirement", "future_requirement", "feedback_received", "inquiry_required")
ENGAGEMENT_OUTCOME_LABELS = {
    "no_requirement": "No Requirement", "future_requirement": "Future Requirement",
    "feedback_received": "Feedback Received", "inquiry_required": "Inquiry Required",
}


class CrmEngagement(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_engagements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=False, index=True)
    # The customer's person spoken to (a contact of the organization).
    org_contact_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_org_contacts.id"), nullable=False)
    engagement_date: Mapped[date] = mapped_column(Date, nullable=False)
    engagement_type: Mapped[str] = mapped_column(String(30), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    outcome: Mapped[str] = mapped_column(String(30), nullable=False)
    next_followup_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
