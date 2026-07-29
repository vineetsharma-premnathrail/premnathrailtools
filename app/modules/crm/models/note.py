from __future__ import annotations
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class Note(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True, index=True)
    org_contact_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_org_contacts.id"), nullable=True)
    related_module: Mapped[str | None] = mapped_column(String(30), nullable=True)
    related_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    universal_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
