from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# The physical breakdown inside a store_locations warehouse: a rack contains
# shelves, a shelf contains bins. bin_type + parent_id together describe the
# level; a top-level rack has parent_id=None.
STORE_BIN_TYPES = ("rack", "shelf", "bin")


class StoreBin(Base, TimestampMixin):
    __tablename__ = "store_bins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False, index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)
    bin_type: Mapped[str] = mapped_column(String(10), nullable=False)
    code: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
