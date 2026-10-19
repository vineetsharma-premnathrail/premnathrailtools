from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Text, ForeignKey, Boolean, JSON, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

# vendor        — Payment voucher to a vendor (Dr Creditors / Cr Bank)
# customer      — Receipt voucher from a customer (Dr Bank / Cr Debtors)
# expense       — Payment voucher straight to expense ledgers, no party
#                 (bank charges, petty expenses). Bills carrying GST go through
#                 a direct purchase invoice instead, or the input credit is lost.
# other_receipt — Receipt voucher to income/other ledgers (interest, refunds)
# contra        — Bank <-> cash or bank <-> bank transfer
# employee      — legacy, reserved
PAYMENT_TYPES = ("vendor", "customer", "expense", "other_receipt", "contra", "employee")
PAYMENT_MODES = ("cheque", "neft", "rtgs", "imps", "upi", "cash", "dd")
# pending_approval — a vendor payment (or a receipt with a write-off / an
# expense payment above the Finance Settings limit) recorded but not yet
# approved: no journal, no voucher number, no allocations until approval.
# rejected — the approver turned it down; nothing was ever posted.
PAYMENT_STATUSES = ("pending_approval", "posted", "rejected", "cancelled")
# Which document an allocation settles, and what settles it:
#   payment    cash part of a receipt/payment voucher (AR/AP control)
#   party_note debit/credit note
#   adjustment a deduction / write-off (accounts_settlement_adjustments row) —
#              LD, penalty, bank charges, short payment, rounding, discount
#   advance    a down payment held on the customer/supplier advance ledger;
#              each allocation posts its own clearing JV (journal_entry_id)
#   journal    a manual JV line tagged to the party (source_id = the line id)
ALLOCATION_TARGET_TYPES = ("vendor_invoice", "ar_transaction")
ALLOCATION_SOURCE_TYPES = ("payment", "party_note", "adjustment", "advance", "journal")


class PaymentTransaction(Base, TimestampMixin):
    """A payment / receipt / contra voucher — every movement of money through
    a bank or cash account. Party vouchers settle invoices bill-wise through
    PaymentAllocation rows; any amount not allocated stays on the party as an
    advance (unallocated_amount) and can be allocated later.

    Bank reconciliation is per side: bank_account_id's side uses
    reconciliation_status/cleared_date; a contra's receiving account
    (counter_bank_account_id) has its own counter_* pair, since the two banks
    clear the same transfer on different days."""

    __tablename__ = "payment_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    payment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="vendor")
    payment_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float] = mapped_column(Money, nullable=False)
    # The bank/cash account money leaves (payment, expense, contra-from) or
    # arrives in (receipt, other receipt).
    bank_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("bank_accounts.id"), nullable=False)
    # Contra only — the account the money arrives in.
    counter_bank_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("bank_accounts.id"), nullable=True)
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True)
    # Legacy single-invoice links (pre bill-wise allocation) — still set when
    # a voucher settles exactly one invoice, for old screens.
    vendor_invoice_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendor_invoices.id"), nullable=True)
    ar_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ar_transactions.id"), nullable=True)
    cheque_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    cheque_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # UTR / transaction reference from the bank.
    reference_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)
    unallocated_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted")
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Down payment (SAP F-29 / F-48, special-GL style): held on the
    # customer_advance / supplier_advance ledger instead of AR/AP control and
    # cleared against the later invoice by an 'advance' allocation. Names the
    # SO / PO it is for, or is 'on account' with a reason.
    is_advance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sales_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_orders.id"), nullable=True)
    billing_line_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_billing_plan_lines.id"), nullable=True)
    purchase_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=True)
    advance_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Held voucher (status pending_approval): the bills it will settle, kept
    # until approval posts it — [{target_type, target_id, amount}].
    pending_allocations: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Set when it came out of an approved payment run (F110).
    payment_proposal_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts_payment_proposals.id"), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Foreign currency: `amount` is INR = amount_fc x exchange_rate (the
    # bank's rate on the day). Settling a foreign bill booked at another rate
    # posts the realised exchange difference (services/fx.py).
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")
    exchange_rate: Mapped[float] = mapped_column(Numeric(18, 6, asdecimal=False), nullable=False, default=1, server_default="1")
    amount_fc: Mapped[float | None] = mapped_column(Money, nullable=True)

    # Bank reconciliation (bank_account_id side) — only ever flipped
    # explicitly via mark_payments_reconciled(), never automatically.
    reconciliation_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    bank_reconciliation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("bank_reconciliations.id"), nullable=True)
    cleared_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Contra receiving side.
    counter_reconciliation_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    counter_bank_reconciliation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("bank_reconciliations.id"), nullable=True)
    counter_cleared_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    lines: Mapped[list["PaymentLine"]] = relationship(
        "PaymentLine", back_populates="payment", cascade="all, delete-orphan", order_by="PaymentLine.line_number",
    )


class PaymentLine(Base, TimestampMixin):
    """Ledger split for expense payments and other receipts."""

    __tablename__ = "payment_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_transaction_id: Mapped[int] = mapped_column(Integer, ForeignKey("payment_transactions.id"), nullable=False, index=True)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    gl_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=False)
    cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    internal_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("internal_orders.id"), nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Money, nullable=False)
    remarks: Mapped[str | None] = mapped_column(String(300), nullable=True)

    payment: Mapped["PaymentTransaction"] = relationship("PaymentTransaction", back_populates="lines")


class PaymentAllocation(Base, TimestampMixin):
    """Bill-wise settlement: `amount` of a source (a payment/receipt voucher,
    or a debit/credit note) set off against a target invoice. The sum of a
    target's allocations is its amount_paid/amount_received; the sum of a
    source's is what it no longer has unallocated."""

    __tablename__ = "payment_allocations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Money, nullable=False)
    allocation_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # 'advance' allocations only: the clearing JV (Dr customer advance / Cr
    # AR, or Dr AP / Cr supplier advance) — reversed when the allocation goes.
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    # Foreign-currency settlement (same currency on both sides, different
    # rates): `amount` is what the bill is cleared by at its booking rate,
    # source_amount what the voucher gives up at its own rate, amount_fc the
    # foreign amount settled, fx_difference = gain (+) / loss (-) posted by
    # fx_journal_entry_id. All null for an INR settlement.
    source_amount: Mapped[float | None] = mapped_column(Money, nullable=True)
    amount_fc: Mapped[float | None] = mapped_column(Money, nullable=True)
    fx_difference: Mapped[float | None] = mapped_column(Money, nullable=True)
    fx_journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)


# payment_transactions.payment_proposal_id references this table — register
# it with the metadata whenever PaymentTransaction is imported.
from app.modules.accounts.models import payment_proposal as _payment_proposal  # noqa: E402,F401
