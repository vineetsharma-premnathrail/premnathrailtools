from __future__ import annotations
from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class ProductCategory(Base, TimestampMixin, SoftDeleteMixin):
    """Growing catalog of product categories — seeded from the initial fixed
    list, but any new value typed on an Inquiry gets added here so it shows
    up as a real dropdown option for everyone afterwards."""
    __tablename__ = "crm_product_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
