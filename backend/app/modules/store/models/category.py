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
    # Item type this top-level category belongs to (filters the item form's
    # Category dropdown). NULL = shown for every type. Unused on subcategories.
    item_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("store_item_categories.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Unused (2026-10-05): Part Code is now always an optional field on the
    # item form, not switched per category. Column kept only so the migration
    # chain (d4e5f6a7b8c0 -> e5f6a7b8c9d1) stays intact; nothing reads it.
    part_code_mode: Mapped[str] = mapped_column(String(20), default="off", server_default="off", nullable=False)


