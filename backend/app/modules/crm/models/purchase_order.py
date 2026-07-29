from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Text, Float, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class PurchaseOrder(Base):
    __tablename__ = "crm_purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inquiry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_inquiries.id"), nullable=True, index=True)
    tender_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_tenders.id"), nullable=True, index=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=False, index=True)
    po_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    po_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_schedule: Mapped[str | None] = mapped_column(Text, nullable=True)
    special_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Active", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
