from __future__ import annotations
from sqlalchemy import String, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class PaymentTerm(Base, TimestampMixin, SoftDeleteMixin):
    """Company-wide standard payment-terms catalog, selectable on a Quotation
    with a free-text 'custom' fallback."""
    __tablename__ = "crm_payment_terms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
