from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Physical inventory (SAP MI01 → MI04 → MI07):
#   counting  — book stock snapshotted, the counted items are FROZEN at this
#               store (no movements) while people count;
#   submitted — differences sent as one Stock Adjustment for the Store
#               Manager's approval (freeze lifted; the adjustment applies the
#               stored difference, so later movements aren't wiped out);
#   posted    — adjustment approved, book stock corrected (or no difference);
#   cancelled — abandoned while counting (freeze lifted, nothing posted).
# A rejected / returned adjustment puts the count back to `counting` for a recount.
STORE_COUNT_STATUSES = ("counting", "submitted", "posted", "cancelled")
STORE_COUNT_FROZEN_STATUSES = ("counting",)


class StorePhysicalCount(Base, TimestampMixin):
    __tablename__ = "store_physical_counts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    count_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False, index=True)
    count_date: Mapped[date] = mapped_column(Date, nullable=False)
    # What was counted, for the record (e.g. "Category: Fasteners" / "All stocked items").
    scope: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Bin-wise count (WM): only this bin is counted and book stock is the bin's stock.
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)
    # Blind count: counters don't see book stock until the count is submitted.
    blind: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="counting", index=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    adjustment_id: Mapped[int | None] = mapped_column(ForeignKey("store_stock_adjustments.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    submitted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["StorePhysicalCountItem"]] = relationship(
        "StorePhysicalCountItem", back_populates="count", cascade="all, delete-orphan", order_by="StorePhysicalCountItem.id"
    )


class StorePhysicalCountItem(Base, TimestampMixin):
    __tablename__ = "store_physical_count_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    count_id: Mapped[int] = mapped_column(ForeignKey("store_physical_counts.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    # Free (on-hand) stock in the books when the count started.
    book_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    # First count kept for audit; counted_quantity is the latest (recount).
    first_counted_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    counted_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    count_rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    counted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    count: Mapped["StorePhysicalCount"] = relationship("StorePhysicalCount", back_populates="items")
    item = relationship("StoreItem")

    @property
    def difference(self) -> float | None:
        return None if self.counted_quantity is None else round(self.counted_quantity - self.book_quantity, 6)
