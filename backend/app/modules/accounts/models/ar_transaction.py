from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Boolean, Date, Text, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money
from app.modules.accounts.models.tax_line import TaxLineMixin

AR_COLLECTION_STATUSES = ("pending", "partial", "collected", "overdue")
AR_TRANSACTION_STATUSES = ("pending", "posted", "cancelled")


class ARTransaction(Base, TimestampMixin):
    """A sales (tax) invoice we raise to a customer (CRM Organization).
    invoice_number is ours — SI/<FY>/<NNNN>, unique per financial year and
    within GST's 16-character limit (older rows keep their ARINV-YYYY-NNNN).

    Amounts: invoice_amount = sum of line taxable values, gst_amount = CGST
    + SGST + IGST, total_amount = invoice_amount + gst_amount + round_off.
    discount_amount is legacy (header-level discount on old invoices); new
    invoices discount per line, before tax, as GST valuation requires.
    amount_received counts every settlement — receipts and credit notes."""

    __tablename__ = "ar_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)

    # GST — snapshot at invoicing time (see VendorInvoice for why).
    customer_gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    place_of_supply_state_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    is_interstate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cgst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    sgst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    igst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)

    invoice_amount: Mapped[float] = mapped_column(Money, nullable=False)
    gst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    discount_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    round_off: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(Money, nullable=False)
    # Legacy single-ledger invoices; new invoices carry a ledger per line.
    revenue_gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)

    billing_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    shipping_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_po_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    customer_po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)

    # E-invoice / e-way bill — captured, not generated: no IRP/GSP API
    # integration yet (see docs/02-modules/finance/FINANCE_STANDARDS_PLAN.md).
    irn: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ack_no: Mapped[str | None] = mapped_column(String(30), nullable=True)
    ack_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    eway_bill_no: Mapped[str | None] = mapped_column(String(20), nullable=True)
    eway_bill_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    vehicle_no: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Purely informational — free text, not validated against the source.
    reference_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reference_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    amount_received: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    amount_due: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    collection_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # Informational only, manually incremented — no automatic dunning.
    dunning_level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Foreign currency (export invoices) — see VendorInvoice.currency.
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")
    exchange_rate: Mapped[float] = mapped_column(Numeric(18, 6, asdecimal=False), nullable=False, default=1, server_default="1")
    amount_fc: Mapped[float | None] = mapped_column(Money, nullable=True)
    amount_due_fc: Mapped[float | None] = mapped_column(Money, nullable=True)

    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    lines: Mapped[list["ARTransactionLine"]] = relationship(
        "ARTransactionLine", back_populates="invoice", cascade="all, delete-orphan", order_by="ARTransactionLine.line_number",
    )


class ARTransactionLine(Base, TimestampMixin, TaxLineMixin):
    __tablename__ = "ar_transaction_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ar_transaction_id: Mapped[int] = mapped_column(Integer, ForeignKey("ar_transactions.id"), nullable=False, index=True)

    invoice: Mapped["ARTransaction"] = relationship("ARTransaction", back_populates="lines")
