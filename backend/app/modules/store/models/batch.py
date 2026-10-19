from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Batch management (SAP MSC1N / MSC3N). A batch is one homogeneous lot of a
# batch-managed item (Item Master "Batch tracked") — for rail components
# usually one steel heat. It is created at the GRN (one row per heat the
# vendor supplied on that line), carries the vendor's heat / batch number and
# the mill test certificate, and every ledger row of the item carries its
# batch_number, so stock by batch and the trace (batch → GRN / vendor →
# issues → work orders / machines) are read from the stock ledger.
#
# active  — in use (stock may or may not remain)
# blocked — Quality / Store stopped its use (e.g. TC doesn't match); issues
#           refuse it until released
STORE_BATCH_STATUSES = ("active", "blocked")


class StoreBatch(Base, TimestampMixin):
    __tablename__ = "store_batches"
    __table_args__ = (UniqueConstraint("item_id", "batch_number", name="uq_store_batch_item_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False, index=True)
    # Internal batch number (BT-YYYY-NNNN) — what every ledger row carries.
    batch_number: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # The supplier's own heat / cast / batch number, as printed on the mill TC.
    heat_number: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)

    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    grn_id: Mapped[int | None] = mapped_column(ForeignKey("p2p_goods_receipts.id"), nullable=True, index=True)
    grn_item_id: Mapped[int | None] = mapped_column(ForeignKey("p2p_goods_receipt_items.id"), nullable=True, index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    received_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # Set at the GRN's store inspection when a multi-batch line is only
    # partly accepted (which heats passed); NULL = follows the line.
    accepted_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    mfg_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Mill test certificate (TC / MTC) — number + the scanned document (SharePoint).
    tc_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tc_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tc_file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    tc_content_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    tc_uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    tc_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
