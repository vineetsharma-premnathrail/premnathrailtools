from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class StoreBinMove(Base, TimestampMixin):
    """Bin-to-bin move inside ONE store (SAP LT10 / LS-transfer): the stock
    stays at the same store with the same value, so it is not a stock-ledger
    movement — it only changes which bin the material sits in.

    Bin stock (services/bins.py) = what the stock ledger posted to the bin
    (GRN putaway, issue, transfer, adjustment rows carrying bin_id) + moves in
    − moves out. from_bin_id None = from the store's unassigned stock (not in
    any bin yet); to_bin_id None = back to unassigned."""

    __tablename__ = "store_bin_moves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    move_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False, index=True)
    from_bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True, index=True)
    to_bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    move_date: Mapped[date] = mapped_column(Date, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
