from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

VISITOR_STATUSES = ("expected", "checked_in", "checked_out", "cancelled")


class HrVisitor(Base, TimestampMixin):
    """Gate visitor log (VIS-YYYY-NNNN). Only the last 4 characters of the
    visitor's ID proof are stored."""

    __tablename__ = "hr_visitors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visit_no: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    visitor_name: Mapped[str] = mapped_column(String(150), nullable=False)
    visitor_company: Mapped[str | None] = mapped_column(String(200), nullable=True)
    visitor_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    visitor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    id_proof_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    id_proof_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    host_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    expected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    badge_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    vehicle_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    items_carried: Mapped[str | None] = mapped_column(Text, nullable=True)
    number_of_persons: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="expected", server_default="expected", index=True, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
