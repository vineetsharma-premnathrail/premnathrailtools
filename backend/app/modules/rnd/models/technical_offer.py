"""R&D's Technical Offer on a requirement (the answer to CRM's Technical Offer
Request): what Premnath offers technically — scope, specification, deviations
and exclusions — as a Word document of record on the letterhead.

One series per requirement, numbered from the requirement's id
(INQ-2026-0042 → TO-2026-0042), revised like a quotation (…-R1, -R2):

    draft → released (R&D head) → superseded (when a later revision is released)

Only a released offer (or a superseded one, for older quotations) can be
quoted against — CRM picks it in the quotation's "Technical Offer" field, so
the commercial offer always points at a reviewed technical one.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

TECHNICAL_OFFER_STATUSES = ("draft", "released", "superseded")


class RndTechnicalOffer(Base, TimestampMixin):
    __tablename__ = "rnd_technical_offers"
    __table_args__ = (UniqueConstraint("offer_number", name="uq_rnd_technical_offer_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # "inquiry" | "tender"
    record_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    offer_number_base: Mapped[str] = mapped_column(String(60), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    offer_number: Mapped[str] = mapped_column(String(80), nullable=False)  # base, or base-R<n>
    offer_date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    technical_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    deviations: Mapped[str | None] = mapped_column(Text, nullable=True)
    exclusions: Mapped[str | None] = mapped_column(Text, nullable=True)
    revision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", server_default="draft")
    created_by_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    released_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
