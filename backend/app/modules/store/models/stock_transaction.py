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
    "manual_in",         # in  — a custom Stock Entry Type (Settings) with effect "in"
    "manual_out",        # out — a custom Stock Entry Type (Settings) with effect "out"
    "quarantine_in",     # quarantine bucket in  — damaged/rejected return, not usable
    "quarantine_out",    # quarantine bucket out — scrapped / returned to vendor / released
    # Stock-type moves (Quality module). "Blocked" is the quarantine bucket.
    "quality_in",        # in  — received into QUALITY stock (inspection lot pending)
    "quality_release",   # QUALITY -> FREE    — inspection lot accepted
    "quality_block",     # QUALITY -> BLOCKED — inspection lot rejected
    "blocked_release",   # BLOCKED -> FREE    — NCR disposition "use as is"
    "blocked_to_quality",  # BLOCKED -> QUALITY — reworked/repaired, back for re-inspection
    "free_block",        # FREE -> BLOCKED    — non-conformance found in usable stock (manual NCR)
    "quality_hold",      # FREE -> QUALITY    — stock pulled back for re-inspection (manual lot)
)

# Stock type(s) each transaction type touches: (from, to). None = outside the
# store (a receipt comes from nowhere, an issue goes nowhere). Free = usable
# on-hand, Quality = awaiting inspection, Blocked = quarantine.
STORE_STOCK_TYPE_EFFECT: dict[str, tuple[str | None, str | None]] = {
    "receipt": (None, "free"), "return_in": (None, "free"), "transfer_in": (None, "free"),
    "adjustment_in": (None, "free"), "manual_in": (None, "free"),
    "issue": ("free", None), "return_out": ("free", None), "transfer_out": ("free", None),
    "adjustment_out": ("free", None), "damage": ("free", None), "manual_out": ("free", None),
    "quarantine_in": (None, "blocked"), "quarantine_out": ("blocked", None),
    "quality_in": (None, "quality"), "quality_release": ("quality", "free"),
    "quality_block": ("quality", "blocked"), "blocked_release": ("blocked", "free"),
    "blocked_to_quality": ("blocked", "quality"), "free_block": ("free", "blocked"),
    "quality_hold": ("free", "quality"),
}

# Where a transaction's quantity came from, for traceability back to the
# source document (a GRN number, an Issue number, ...). reference_number is
# free text rather than a hard FK, since the source can be in another module
# (P2P) or not exist yet (a manual correction has no source doc).
STORE_STOCK_TXN_REFERENCE_TYPES = ("grn", "material_issue", "material_return", "stock_transfer", "stock_adjustment", "work_order", "manual", "maintenance_work_order", "inspection_lot", "ncr")


class StoreStockTransaction(Base, TimestampMixin):
    __tablename__ = "store_stock_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False, index=True)
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("store_bins.id"), nullable=True)

    transaction_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Manual entries only: the StoreDocType "stock_entry" value picked on
    # Record Stock Entry, so custom types show their own label in history.
    entry_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    reference_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reference_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Supplier on manual stock-in entries (free text, suggested from the vendor master).
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
