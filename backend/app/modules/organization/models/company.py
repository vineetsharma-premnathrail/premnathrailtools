from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class Company(Base, TimestampMixin):
    """Single-record company master (Organization > Company tab) — this app
    is single-company, so the frontend shows this as a view/edit form for the
    one row rather than a list, ERPNext-Company-doctype style."""

    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    gst_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    pan_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Letterhead content (Organization > Letter Head tab) — a company-scoped
    # HTML snippet/header used when generating outgoing documents. Kept as a
    # single text field rather than a separate table since it's 1:1 with the
    # company and has no independent lifecycle of its own.
    letterhead_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    default_currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tax_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(100), nullable=True)
    date_of_establishment: Mapped[date | None] = mapped_column(Date, nullable=True)
    gst_category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reporting_currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    registration_details: Mapped[str | None] = mapped_column(Text, nullable=True)
