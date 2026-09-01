from __future__ import annotations
from sqlalchemy import String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

WORK_ORDER_STATUSES = {"planned", "in_progress", "completed", "cancelled"}


class WorkOrder(Base, TimestampMixin):
    __tablename__ = "manufacturing_work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wo_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    bom_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_boms.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
