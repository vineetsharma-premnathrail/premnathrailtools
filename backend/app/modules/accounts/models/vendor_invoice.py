from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

MATCHING_STATUSES = ("matched", "variance", "approved_variance")
PAYMENT_STATUSES = ("pending", "partial", "paid")
VENDOR_INVOICE_STATUSES = ("pending", "posted", "cancelled")


class VendorInvoice(Base, TimestampMixin):
    """A vendor bill entered against a P2P purchase order, matched 3-way
    (PO qty/amount vs GRN accepted qty vs this invoice) before it's allowed
    to post. See old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 3."""

    __tablename__ = "vendor_invoices"
    __table_args__ = (UniqueConstraint("vendor_id", "invoice_number", name="uq_vendor_invoice_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=False)
    vendor_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=False)
    invoice_number: Mapped[str] = mapped_column(String(100), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    invoice_amount: Mapped[float] = mapped_column(Float, nullable=False)
    invoice_gst: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    invoice_total: Mapped[float] = mapped_column(Float, nullable=False)
    # The expense/inventory GL account this invoice's amount is debited to —
    # picked by the user on entry since neither P2PPurchaseOrder nor its
    # items carry a GL account (see Phase 3 plan's phase-boundary note).
    expense_gl_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=False)

    qty_po: Mapped[float | None] = mapped_column(Float, nullable=True)
    qty_gr: Mapped[float | None] = mapped_column(Float, nullable=True)
    qty_invoice: Mapped[float | None] = mapped_column(Float, nullable=True)
    matching_status: Mapped[str] = mapped_column(String(20), nullable=False, default="matched")

    payment_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    amount_paid: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    amount_due: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    variance_approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    variance_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    variance_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
