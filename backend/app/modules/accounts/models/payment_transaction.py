from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

PAYMENT_TYPES = ("vendor", "customer", "employee", "other")
PAYMENT_MODES = ("cheque", "neft", "rtgs", "cash")


class PaymentTransaction(Base, TimestampMixin):
    """A cash/bank movement — this phase only ever creates payment_type
    'vendor' (paying a VendorInvoice); 'customer'/'employee' are reserved
    columns for Phase 4/5, not used yet. See
    old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 3."""

    __tablename__ = "payment_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    payment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="vendor")
    payment_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    bank_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("bank_accounts.id"), nullable=False)
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    vendor_invoice_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendor_invoices.id"), nullable=True)
    # Phase 4 (AR) — set instead of vendor_id/vendor_invoice_id when
    # payment_type="customer" (a collection against an ARTransaction).
    ar_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ar_transactions.id"), nullable=True)
    cheque_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    cheque_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Phase 6 (Cash Management) — whether this payment has cleared the bank
    # yet. Only ever flipped explicitly via mark_payments_reconciled(), never
    # automatically. See old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 6.
    reconciliation_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    bank_reconciliation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("bank_reconciliations.id"), nullable=True)
