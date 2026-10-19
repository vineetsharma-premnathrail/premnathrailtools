from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin


class StoreStockEntry(Base, TimestampMixin):
    """A manual stock entry document (Store › Stock › Record Stock Entry):
    one entry type, one store, any number of item lines and the supporting
    documents (supplier invoice / challan scans). Each line is posted as a
    stock ledger row with reference_type "stock_entry" and this entry's
    number, so Movements links back to it. Posted entries are immutable."""

    __tablename__ = "store_stock_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    entry_type: Mapped[str] = mapped_column(String(50), nullable=False)  # StoreDocType kind "stock_entry"
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    attachments: Mapped[list["StoreStockEntryAttachment"]] = relationship(
        "StoreStockEntryAttachment", back_populates="entry", cascade="all, delete-orphan"
    )


class StoreStockEntryAttachment(Base, TimestampMixin):
    """Supporting document of a stock entry, stored in SharePoint."""

    __tablename__ = "store_stock_entry_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("store_stock_entries.id"), index=True, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    entry: Mapped["StoreStockEntry"] = relationship("StoreStockEntry", back_populates="attachments")
