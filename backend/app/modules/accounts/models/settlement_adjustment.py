from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

# Why part of an invoice is settled without cash (SAP F-28/F-32 payment
# difference). Each reason has its own ledger role (models/settings.py); a
# reduction that changes the taxable value (rate difference, price discount
# after supply, return) is NOT a deduction — it needs a credit/debit note so
# GST is reversed too.
ADJUSTMENT_REASONS: dict[str, str] = {
    "ld_deduction": "Liquidated damages (LD)",
    "penalty": "Penalty",
    "bank_charges": "Bank charges",
    "short_payment": "Short payment written off",
    "rounding": "Rounding / small difference",
    "cash_discount": "Cash (early-payment) discount",
    "other": "Other (pick the ledger)",
}
ADJUSTMENT_STATUSES = ("pending", "posted", "cancelled")


class SettlementAdjustment(Base, TimestampMixin):
    """A deduction or write-off that settles part of one invoice without cash.

    With a voucher (payment_transaction_id set) it is part of that receipt/
    payment's journal: receipt = Dr Bank (net) + Dr deduction ledger / Cr AR
    (gross); vendor payment = Dr AP (gross) / Cr Bank (net) + Cr deduction
    ledger. A standalone write-off (no voucher) has its own journal
    (journal_entry_id). Either way it settles the invoice through a
    PaymentAllocation with source_type 'adjustment'."""

    __tablename__ = "accounts_settlement_adjustments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("payment_transactions.id"), nullable=True, index=True)
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    gl_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=False)
    cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    amount: Mapped[float] = mapped_column(Money, nullable=False)
    adjustment_date: Mapped[date] = mapped_column(Date, nullable=False)
    remarks: Mapped[str | None] = mapped_column(String(300), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
