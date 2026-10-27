from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey, CheckConstraint
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
    Held in store, NOT in stock; stock is added later by the GRN on the PO."""

    __tablename__ = "store_pre_po_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True, index=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    store_location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)
    delivery_challan_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vendor_invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending_po", server_default="pending_po", nullable=False)
    p2p_request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=True, index=True)
    purchase_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    cancelled_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    receipt: Mapped["StorePrePoReceipt"] = relationship("StorePrePoReceipt", back_populates="items")
    store_item = relationship("StoreItem")


# Vendor paperwork received with the goods.
STORE_PRE_PO_ATTACHMENT_TYPES = ("invoice", "challan", "other")


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
