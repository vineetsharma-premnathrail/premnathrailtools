from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class Activity(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    org_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True, index=True)
    org_contact_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_org_contacts.id"), nullable=True)
    related_module: Mapped[str | None] = mapped_column(String(30), nullable=True)
    related_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    universal_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    next_followup: Mapped[date | None] = mapped_column(Date, nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String(150), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Open", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
