from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# The single append-only ledger every Store doc type posts to. `quantity` is
# always stored positive; direction (in vs out of on-hand stock) is derived
# from `transaction_type` by STORE_STOCK_TXN_DIRECTION in
# app.modules.store.service, not encoded as a signed value here, so every
# row reads naturally ("received 40", not "received -40").
STORE_STOCK_TXN_TYPES = (
    "receipt",          # in  — material receipt (e.g. against a P2P GRN)
    "issue",             # out — material issued to a department/project
    "return_in",         # in  — unused/rejected material returned to stock
    "return_out",        # out — material returned to a vendor
    "transfer_in",        # in  — stock transfer arriving at this location
    "transfer_out",       # out — stock transfer leaving this location
    "adjustment_in",       # in  — stock adjustment, actual > system
    "adjustment_out",      # out — stock adjustment, actual < system
    "damage",            # out — stock written off as damaged
)

# Where a transaction's quantity came from, for traceability back to the
# source document (a GRN number, an Issue number, ...). reference_number is
# free text rather than a hard FK, since the source can be in another module
# (P2P) or not exist yet (a manual correction has no source doc).
STORE_STOCK_TXN_REFERENCE_TYPES = ("grn", "material_issue", "material_return", "stock_transfer", "stock_adjustment", "manual")


class StoreStockTransaction(Base, TimestampMixin):
    __tablename__ = "store_stock_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False, index=True)
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)

    transaction_type: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    reference_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reference_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
