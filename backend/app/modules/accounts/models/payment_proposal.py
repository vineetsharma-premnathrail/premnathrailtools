from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

# draft      built, lines can be excluded / amounts trimmed
# submitted  waiting in the approval engine (accounts.payment_run)
# approved   approved — ready to execute (post the payment vouchers)
# executed   one payment voucher per vendor posted; bank file available
# rejected   turned down in approval (can be edited and re-submitted)
# cancelled  abandoned
PROPOSAL_STATUSES = ("draft", "submitted", "approved", "executed", "rejected", "cancelled")


class PaymentProposal(Base, TimestampMixin):
    """SAP F110-style payment run: the vendor bills due by `pay_by_date`,
    picked for payment from one bank account, approved as one batch and then
    executed into one payment voucher per vendor."""

    __tablename__ = "accounts_payment_proposals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    proposal_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    run_date: Mapped[date] = mapped_column(Date, nullable=False)
    pay_by_date: Mapped[date] = mapped_column(Date, nullable=False)
    bank_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("bank_accounts.id"), nullable=False)
    payment_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="neft")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    total_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    executed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    lines: Mapped[list["PaymentProposalLine"]] = relationship(
        "PaymentProposalLine", back_populates="proposal", cascade="all, delete-orphan", order_by="PaymentProposalLine.id",
    )


class PaymentProposalLine(Base, TimestampMixin):
    """One due vendor bill in a run. amount = cash to pay; discount_amount =
    early-payment discount taken (posted to discount_received); credit_amount
    = open debit notes / supplier advances set off before paying."""

    __tablename__ = "accounts_payment_proposal_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    proposal_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts_payment_proposals.id"), nullable=False, index=True)
    vendor_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=False)
    vendor_invoice_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendor_invoices.id"), nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount_due: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    credit_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    discount_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    excluded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    exclusion_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    payment_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("payment_transactions.id"), nullable=True)

    proposal: Mapped["PaymentProposal"] = relationship("PaymentProposal", back_populates="lines")
