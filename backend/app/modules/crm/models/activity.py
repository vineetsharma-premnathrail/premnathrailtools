from __future__ import annotations
from datetime import date
from typing import Any
from sqlalchemy import String, Integer, Text, Date, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class Activity(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    org_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True, index=True)
    org_contact_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_org_contacts.id"), nullable=True)
    related_module: Mapped[str | None] = mapped_column(String(30), nullable=True)
    related_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    universal_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    activity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_followup: Mapped[date | None] = mapped_column(Date, nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String(150), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Open", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # Ordered list of {observation, action_plan, responsibility, target_date} rows —
    # lets one activity expand into a full multi-row MOM table on its own,
    # instead of needing one Activity record per MOM row.
    mom_items: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    # Additional contacts present alongside org_contact_id (kept for backward
    # compatibility as the "primary" contact) — lets one activity record
    # multiple client attendees instead of just one.
    contact_ids: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
