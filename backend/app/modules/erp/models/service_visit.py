"""Service confirmations (SAP IW41 for customer service orders): one row per
field-engineer visit on a service request. An SR can have many visits and
many engineers; each visit records time on site, travel, expenses, the work
done and the customer's sign-off. The SR's billing roll-up
(erp/visits.py apply_visit_rollup) sums them into the SR charges."""
from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class ServiceVisit(Base, TimestampMixin):
    __tablename__ = "erp_service_visits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    service_request_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("erp_service_requests.id", ondelete="CASCADE"), index=True, nullable=False)
    engineer_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    visit_date: Mapped[date] = mapped_column(Date, nullable=False)
    travel_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    arrive_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    depart_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    work_hours: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    travel_hours: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    km: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    travel_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    stay_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    misc_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    work_done: Mapped[str] = mapped_column(Text, nullable=False)
    customer_sign_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    customer_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # SR attachment holding the signed service report (scan / photo).
    report_attachment_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("erp_service_request_attachments.id", ondelete="SET NULL"), nullable=True)
    # Bumped on every edit, so the managed Word service report is regenerated.
    document_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
