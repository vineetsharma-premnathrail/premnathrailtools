from __future__ import annotations
from sqlalchemy import String, Integer, Text, Date, DateTime, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class UserDocument(Base, TimestampMixin):
    """A document uploaded against a user (ID proof, offer letter, etc.),
    stored in SharePoint (only the pointer/metadata lives here — the actual
    bytes live in SharePoint).

    Employees without a portal account (HR > Employees, no login) own their
    documents through hr_profile_id; user_id is filled in when that record is
    linked to an account (hr/services/workforce_link.py)."""

    __tablename__ = "user_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    hr_profile_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hr_employee_profiles.id"), index=True, nullable=True)
    # Which joining-document checklist item this file satisfies (hr workforce_rules.DOCUMENTS key).
    checklist_key: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # HR's check of the file: pending → verified / rejected (rejection needs remarks).
    verification_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    verified_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    document_type: Mapped[str] = mapped_column(String(50), nullable=False)
    document_name: Mapped[str] = mapped_column(String(200), nullable=False)
    document_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    issue_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    issuing_authority: Mapped[str | None] = mapped_column(String(150), nullable=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    confidentiality: Mapped[str | None] = mapped_column(String(30), nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
