from __future__ import annotations
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class StoreLocation(Base, TimestampMixin):
    __tablename__ = "store_locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    warehouse_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    manager_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    inventory_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    operating_hours: Mapped[str | None] = mapped_column(String(150), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active")
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
