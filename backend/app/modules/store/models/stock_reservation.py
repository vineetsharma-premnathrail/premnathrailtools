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

    # Project stock (SAP special stock via reservation, 2026-10-17): the Order
    # Project vehicle / lot this stock is held for. A project hold blocks the
    # quantity from free stock like any reservation; an issue for the same
    # element consumes it first (store/services/project_stock.py), an issue
    # for anything else is refused unless a Store Manager overrides it with a
    # reason. The free-text project / production_order above stay for old rows.
    order_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("pm_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    order_project_element_id: Mapped[int | None] = mapped_column(
        ForeignKey("pm_project_elements.id", ondelete="SET NULL"), nullable=True, index=True)
    # Where an automatic hold came from: "grn_item" (bought-out material of a
    # project PO line, source_id = the GRN line), "manual" / NULL by hand.
    source_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    source_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # What was first held — `quantity` is what is STILL held (an issue against
    # the reservation lowers it, as Production's work-order holds do).
    original_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
