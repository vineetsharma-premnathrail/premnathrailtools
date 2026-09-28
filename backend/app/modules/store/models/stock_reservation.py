from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# active: reserved_qty is earmarked against this reservation, blocking it
# from other allocation (see StoreStockBalance.reserved_qty).
# fulfilled: the material was actually issued against this reservation —
# the earmark is released here; the on_hand decrease itself happens through
# a separate Material Issue, this module doesn't auto-consume a reservation.
# cancelled: the earmark is released without material ever being issued.
STORE_RESERVATION_STATUSES = ("active", "fulfilled", "cancelled")


class StoreStockReservation(Base, TimestampMixin):
    __tablename__ = "store_stock_reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reservation_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)

    project: Mapped[str | None] = mapped_column(String(150), nullable=True)
    production_order: Mapped[str | None] = mapped_column(String(150), nullable=True)
    reserved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    required_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
