from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Boolean, Date, DateTime, Text, ForeignKey, UniqueConstraint, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money, Quantity
from app.modules.accounts.models.tax_line import TaxLineMixin

MATCHING_STATUSES = ("matched", "variance", "approved_variance", "not_applicable")
PAYMENT_STATUSES = ("pending", "partial", "paid")
VENDOR_INVOICE_STATUSES = ("pending", "posted", "cancelled")
# "po" — goods/services against an approved P2P purchase order, 3-way matched.
# "direct" — bills with no PO behind them (rent, power, professional fees,
# freight): no match, but still maker-checker before posting.
# "opening" — an unpaid bill brought in from the old books (services/opening.py).
VENDOR_INVOICE_TYPES = ("po", "direct", "opening")


class VendorInvoice(Base, TimestampMixin):
    """A purchase invoice (vendor bill). PO invoices are matched 3-way (PO
    qty/amount vs GRN accepted qty vs this invoice) before they may post. See
    old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 3.

    Amounts: invoice_amount = sum of line taxable values, invoice_gst = CGST
    + SGST + IGST, invoice_total = invoice_amount + invoice_gst + round_off
    (what the vendor is owed — under reverse charge the GST is not owed to
    the vendor, so invoice_total excludes it). amount_paid counts every
    settlement — payments and debit-note adjustments alike."""

    __tablename__ = "vendor_invoices"
    __table_args__ = (UniqueConstraint("vendor_id", "invoice_number", name="uq_vendor_invoice_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # SM12 optimistic lock (core/optimistic_lock.py): bumped on every UPDATE;
    # a save carrying an older X-Lock-Version gets 409 "changed by X at T".
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    lock_changed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    __mapper_args__ = {"version_id_col": lock_version}
    invoice_type: Mapped[str] = mapped_column(String(10), nullable=False, default="po")
    purchase_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=True)
    vendor_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=False)
    invoice_number: Mapped[str] = mapped_column(String(100), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # GST — snapshot of the vendor's GSTIN and the place of supply at booking
    # time, so a later master edit never rewrites a filed return.
    vendor_gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    place_of_supply_state_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    is_interstate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_reverse_charge: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cgst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    sgst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    igst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)

    invoice_amount: Mapped[float] = mapped_column(Money, nullable=False)
    invoice_gst: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    round_off: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    invoice_total: Mapped[float] = mapped_column(Money, nullable=False)
    # Legacy single-ledger invoices (before line items). New invoices carry a
    # ledger per line and leave this null.
    expense_gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)

    qty_po: Mapped[float | None] = mapped_column(Quantity, nullable=True)
    qty_gr: Mapped[float | None] = mapped_column(Quantity, nullable=True)
    qty_invoice: Mapped[float | None] = mapped_column(Quantity, nullable=True)
    matching_status: Mapped[str] = mapped_column(String(20), nullable=False, default="matched")

    payment_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    amount_paid: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    amount_due: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    # Per-invoice payment block (SAP payment block key): a blocked bill is
    # left out of payment runs and can't be paid until Finance releases it.
    payment_block: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    payment_block_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # Foreign currency (import bills). Every amount above is INR; these keep
    # the document currency, the rate it was booked at and what is owed / still
    # open in that currency (services/fx.py). INR bills: currency 'INR', rate 1.
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")
    exchange_rate: Mapped[float] = mapped_column(Numeric(18, 6, asdecimal=False), nullable=False, default=1, server_default="1")
    amount_fc: Mapped[float | None] = mapped_column(Money, nullable=True)
    amount_due_fc: Mapped[float | None] = mapped_column(Money, nullable=True)

    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    variance_approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    variance_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    variance_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    lines: Mapped[list["VendorInvoiceLine"]] = relationship(
        "VendorInvoiceLine", back_populates="invoice", cascade="all, delete-orphan", order_by="VendorInvoiceLine.line_number",
    )


class VendorInvoiceLine(Base, TimestampMixin, TaxLineMixin):
    __tablename__ = "vendor_invoice_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_invoice_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendor_invoices.id"), nullable=False, index=True)
    po_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_purchase_order_items.id"), nullable=True)
    # Line-level 3-way match result (SAP MIRO per-item check) for PO lines:
    # "matched" | "variance"; qty_variance = invoiced - (received - already
    # invoiced) in the PO unit; price_variance = (invoice rate - PO rate) x qty.
    match_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    qty_variance: Mapped[float | None] = mapped_column(Quantity, nullable=True)
    price_variance: Mapped[float | None] = mapped_column(Money, nullable=True)

    invoice: Mapped["VendorInvoice"] = relationship("VendorInvoice", back_populates="lines")
