from __future__ import annotations
from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class CrmDocumentCategory(Base, TimestampMixin, SoftDeleteMixin):
    """Categories a user picks when uploading a Client / Internal document on
    an inquiry or tender (RFQ, BOQ, Drawings…). Managed in CRM › Settings ›
    Lists. Documents store the label as text, so removing a category never
    touches documents already filed under it; renaming one re-labels them."""
    __tablename__ = "crm_document_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
