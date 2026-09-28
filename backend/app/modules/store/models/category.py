from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class StoreItemCategory(Base, TimestampMixin):
    """Item category master. Self-referencing via parent_id so the same
    table serves both category and subcategory — a row with parent_id set
    is a subcategory of the row it points to."""

    __tablename__ = "store_item_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("store_item_categories.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
