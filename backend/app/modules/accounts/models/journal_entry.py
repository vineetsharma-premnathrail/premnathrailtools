from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

JE_STATUSES = ("draft", "posted", "reversed", "cancelled")
JE_POSTING_TYPES = ("adjustment", "invoice", "payment", "salary", "transfer", "production_settlement")


class JournalEntry(Base, TimestampMixin):
    """The only unit of double-entry posting in this module. Every later
    phase's post_vendor_invoice()/post_customer_invoice()/post_payroll() etc.
    creates one of these through accounts/service.py's post_journal_entry() —
    never inserted directly by a route. See
    old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 2."""

    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    posting_date: Mapped[date] = mapped_column(Date, nullable=False)
    accounting_period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)  # "YYYY-MM"
    posting_type: Mapped[str] = mapped_column(String(30), nullable=False, default="adjustment")
    # Generic reference to whatever business document caused this posting
    # (a VendorInvoice, PaymentTransaction, ...) once those exist — unused
    # by this phase's manual entries.
    reference_document_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_document_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_debit: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    total_credit: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted")

    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    posted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Set on the ORIGINAL entry once reversed — the reversal itself is a
    # brand new JournalEntry, this entry is never edited/deleted.
    reversal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reversed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # Set on the REVERSING entry, pointing back at the original.
    reverses_journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)

    lines: Mapped[list["JournalEntryLine"]] = relationship(
        "JournalEntryLine", back_populates="journal_entry", cascade="all, delete-orphan"
    )


class JournalEntryLine(Base, TimestampMixin):
    __tablename__ = "journal_entry_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    journal_entry_id: Mapped[int] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    gl_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=False)
    cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    internal_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("internal_orders.id"), nullable=True)
    # Which sub-ledger this line affects, once AP/AR exist (Phase 3/4) —
    # unused by this phase's manual entries.
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True)
    debit_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    credit_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    journal_entry: Mapped["JournalEntry"] = relationship("JournalEntry", back_populates="lines")
