from __future__ import annotations
from typing import TYPE_CHECKING
from datetime import date, datetime
from sqlalchemy import String, Integer, Text, Float, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.crm.models.organization import Organization


class Tender(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_tenders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    universal_id: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)

    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=False, index=True)
    org_contact_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_org_contacts.id"), nullable=True)

    tender_number: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    tender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tender_authority: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tender_portal: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tender_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tender_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tender_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="INR")

    status: Mapped[str] = mapped_column(String(50), default="Requirement Received", nullable=False)
    current_stage: Mapped[str] = mapped_column(String(50), default="Tender Published", nullable=False)
    # Free-text running note on where things stand right now — distinct from the
    # fixed `status`/`current_stage` values, edited independently and logged like
    # any other info field (see _write_spec_revision in routes/tenders.py).
    current_status_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    lead_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="Medium", nullable=False)
    bd_owner: Mapped[str | None] = mapped_column(String(150), nullable=True)

    railway_zone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    division: Mapped[str | None] = mapped_column(String(150), nullable=True)
    workshop: Mapped[str | None] = mapped_column(String(150), nullable=True)

    publish_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    doc_download_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    pre_bid_meeting_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    query_submission_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    submission_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    opening_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    financial_opening_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expected_award_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    participate: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    decision_by: Mapped[str | None] = mapped_column(String(150), nullable=True)
    decision_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reason_no_participate: Mapped[str | None] = mapped_column(Text, nullable=True)

    awarded_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    loi_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contract_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    loss_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Technical Offer Request — button is enabled again whenever the tender is updated
    # after the last request was sent (technical_offer_sent_at < updated_at).
    technical_offer_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    technical_offer_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="tenders")
