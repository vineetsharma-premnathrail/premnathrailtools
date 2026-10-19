from __future__ import annotations
from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class ProductApplication(Base, TimestampMixin):
    """Where/what a finished product is used for (e.g. "OHE inspection",
    "Rail grinding", "Track sanding"). One application can be served by many
    products and one product can serve many applications — see
    product_application_links. Retired with is_active=false, never deleted,
    so products already tagged keep their history."""

    __tablename__ = "product_applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
