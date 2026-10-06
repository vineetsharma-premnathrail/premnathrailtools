from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Why the first article is needed (rule 9). new_item = the item has never
# had an approved FAI; new_revision = an FAI was approved but against an
# older released drawing revision; new_vendor = the item has an approved
# FAI, but not from this vendor; manual = raised by hand.
QUALITY_FAI_TRIGGERS = ("new_item", "new_revision", "new_vendor", "manual")
QUALITY_FAI_TRIGGER_LABELS = {
    "new_item": "New item", "new_revision": "New drawing revision", "new_vendor": "New vendor", "manual": "Raised manually",
}

# open (first article being inspected) → approved | rejected; cancelled only
# while open and only for a manual FAI with no decided lot. An approved FAI
# releases the item + drawing revision + source (vendor or in-house) for
# regular lots; a rejected one means the next receipt / production is a
# fresh first article.
QUALITY_FAI_STATUSES = ("open", "approved", "rejected", "cancelled")


class QualityFirstArticle(Base, TimestampMixin):
    """First Article Inspection (FAI) for one item × drawing revision ×
    source. vendor_name NULL = made in-house (production); otherwise the
    supplier / job worker. drawing_ref is the item's released drawing
    revision(s) in the Design module at the time (e.g. "DWG-0012 rev B"),
    NULL when the item has no released drawing."""

    __tablename__ = "quality_first_articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fai_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    drawing_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    trigger: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True, nullable=False)

    # What brought the first article in (GRN, work order, manual).
    source_type: Mapped[str] = mapped_column(String(30), nullable=False)
    source_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # The first-article inspection lot (full drawing check).
    lot_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspection_lots.id"), index=True, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
