from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import Boolean, String, Integer, Float, Date, DateTime, Text, ForeignKey, CheckConstraint, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

# pending_po: goods are in the store, Procurement has not made the PO yet.
# po_created: Procurement made the draft PO from this receipt.
# closed: the PO's goods were received through GRN in full.
# cancelled: withdrawn by Store (reason required) while still pending_po.
STORE_PRE_PO_STATUSES = ("pending_po", "po_created", "closed", "cancelled")


class StorePrePoReceipt(Base, TimestampMixin):
    """Goods that physically arrived before their purchase order exists.
    Since 2026-11-06 (owner) the receipt posts stock at once: Free stock (issuable),
    or Quality stock + an inspection lot for an item flagged 'Quality check on
    receipt'. The later GRN on the PO settles that quantity instead of posting it
    again (stock_posted). Receipts made before that change were never posted, so
    their GRN still posts the stock as before."""

    __tablename__ = "store_pre_po_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True, index=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    store_location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)
    delivery_challan_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    delivery_challan_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # PO not in the portal's PO list (made in Tally / by the vendor): typed by the store (owner, 2026-11-13).
    manual_po_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    manual_po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    vendor_invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vendor_invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending_po", server_default="pending_po", nullable=False)
    p2p_request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=True, index=True)
    purchase_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    cancelled_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # True = this receipt put its goods into stock itself (2026-11-06 onwards).
    stock_posted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    items: Mapped[list["StorePrePoReceiptItem"]] = relationship(
        "StorePrePoReceiptItem", back_populates="receipt",
        cascade="all, delete-orphan", order_by="StorePrePoReceiptItem.id",
    )
    attachments: Mapped[list["StorePrePoReceiptAttachment"]] = relationship(
        "StorePrePoReceiptAttachment", back_populates="receipt",
        cascade="all, delete-orphan", order_by="StorePrePoReceiptAttachment.id",
    )


class StorePrePoReceiptItem(Base, TimestampMixin):
    """One Item Master line of a Before-PO receipt (always by store_item_id)."""

    __tablename__ = "store_pre_po_receipt_items"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_store_pre_po_receipt_items_qty_pos"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("store_pre_po_receipts.id", ondelete="CASCADE"), nullable=False, index=True)
    store_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=False, index=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # The name printed on the vendor's invoice / challan for this line, when it differs (owner, 2026-11-07).
    invoice_item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Rate per unit as known at the gate (vendor quote / bill), optional. Values the
    # stock until the PO comes; the GRN on the PO revalues to the PO rate.
    unit_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Where the stock went: 'free' or 'quality' (inspection lot); NULL = not posted (older receipts).
    receipt_posting: Mapped[str | None] = mapped_column(String(10), nullable=True)
    inspection_lot_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("quality_inspection_lots.id", ondelete="SET NULL"), nullable=True)
    # Quantity already matched by GRN lines of the PO (never posted again).
    settled_qty: Mapped[float] = mapped_column(Float, default=0, server_default="0", nullable=False)

    receipt: Mapped["StorePrePoReceipt"] = relationship("StorePrePoReceipt", back_populates="items")
    store_item = relationship("StoreItem")


# Vendor paperwork received with the goods.
STORE_PRE_PO_ATTACHMENT_TYPES = ("invoice", "challan", "po", "other")


class StorePrePoReceiptAttachment(Base, TimestampMixin):
    """A file (vendor invoice, delivery challan, ...) attached to a Before-PO
    receipt. Only the SharePoint pointer lives here, like P2PRequestAttachment."""

    __tablename__ = "store_pre_po_receipt_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("store_pre_po_receipts.id", ondelete="CASCADE"), nullable=False, index=True)
    doc_type: Mapped[str] = mapped_column(String(20), nullable=False, default="other", server_default="other")
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    receipt: Mapped["StorePrePoReceipt"] = relationship("StorePrePoReceipt", back_populates="attachments")


class StoreItemVendorName(Base, TimestampMixin):
    """The name a vendor's bill gives an Item Master item (owner, 2026-11-13). Learnt from the
    "Name on invoice" of every receipt line, so the next bill from the same vendor with the same
    name fills the item by itself. One vendor + name points to one item (the latest pick wins)."""

    __tablename__ = "store_item_vendor_names"
    __table_args__ = (UniqueConstraint("vendor_id", "name_key", name="uq_store_item_vendor_names_vendor_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    store_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # invoice_name lower-cased with single spaces: "SKF  6205-2RS" and "skf 6205-2rs" are the same bill name.
    name_key: Mapped[str] = mapped_column(String(255), nullable=False)
    times_used: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    last_used_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


def bill_name_key(name: str | None) -> str:
    return " ".join((name or "").split()).lower()
