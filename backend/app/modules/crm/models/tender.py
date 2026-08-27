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

    status: Mapped[str] = mapped_column(String(50), default="Active", nullable=False)
    current_stage: Mapped[str] = mapped_column(String(50), default="Tender Published", nullable=False)

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
    tasks: Mapped[list["TenderTask"]] = relationship(
        "TenderTask", back_populates="tender", cascade="all, delete-orphan"
    )
    competitors: Mapped[list["TenderCompetitor"]] = relationship(
        "TenderCompetitor", back_populates="tender", cascade="all, delete-orphan"
    )


class TenderTask(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_tender_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tender_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_tenders.id"), nullable=False, index=True)
    department: Mapped[str] = mapped_column(String(100), nullable=False)
    task_title: Mapped[str] = mapped_column(String(255), nullable=False)
    assigned_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assigned_user_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="Medium", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Pending", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    tender: Mapped["Tender"] = relationship("Tender", back_populates="tasks")


class TenderCompetitor(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_tender_competitors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tender_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_tenders.id"), nullable=False, index=True)
    competitor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    expected_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    tender: Mapped["Tender"] = relationship("Tender", back_populates="competitors")
