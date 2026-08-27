from __future__ import annotations
from sqlalchemy import String, Integer, Text, Float
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class Product(Base, TimestampMixin, SoftDeleteMixin):
    """Company-wide product/model catalog used to prefill quotation line items."""
    __tablename__ = "crm_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_number: Mapped[str | None] = mapped_column(String(150), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    default_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
