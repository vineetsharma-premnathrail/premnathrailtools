from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

JE_STATUSES = ("draft", "posted", "reversed", "cancelled")
# Statuses whose lines count in the books. A reversed original still counts —
# its reversal is a separate posted entry that cancels it out.
JE_LEDGER_STATUSES = ("posted", "reversed")
JE_POSTING_TYPES = (
    "adjustment", "accrual", "correction", "depreciation", "opening", "closing_stock", "year_end", "gst_setoff",
    "invoice", "debit_note", "credit_note", "payment", "receipt", "contra",
    "salary", "transfer", "production_settlement", "asset_disposal",
    "asset_capitalisation", "fx_difference", "fx_revaluation",
    "co_allocation",  # CO assessment / distribution cycle run (services/co_allocation.py)
)
# Manual journal sub-types a user may pick; everything else is system-posted.
JE_MANUAL_POSTING_TYPES = ("adjustment", "accrual", "correction", "depreciation")

# Voucher type -> number-series prefix. A voucher number is
# <PREFIX>/<FY>/<NNNN>, e.g. JV/2026-27/0001, sequence per type per FY.
VOUCHER_TYPES = {
    "journal": "JV", "payment": "PV", "receipt": "RV", "contra": "CV",
    "purchase": "PI", "sales": "SI", "debit_note": "DN", "credit_note": "CN", "opening": "OB",
}

# Idempotency backstops (migration b7d3f1a9c2e4). The service layer row-locks
# the document before posting; these make a double posting impossible even on
# a path that forgets to. A journal is inserted as 'draft' and flipped to
# 'posted' in the same transaction, so the indexes must hold from the INSERT:
#   - one live original journal per business document (reversals excluded;
#     a reversed original no longer counts, so the remedy for a double
#     posting is to reverse the extra voucher);
#   - at most one live reversal per journal;
#   - one live year-end close per FY, GST set-off per month, opening voucher.
_ONE_LIVE = "status IN ('draft', 'posted')"
_JE_ORIGINAL = f"reference_document_id IS NOT NULL AND reverses_journal_entry_id IS NULL AND {_ONE_LIVE}"
_JE_REVERSAL = f"reverses_journal_entry_id IS NOT NULL AND {_ONE_LIVE}"
# A reversal keeps its original's posting_type, so these exclude reversals too.
_ONE_LIVE_ORIGINAL = f"reverses_journal_entry_id IS NULL AND {_ONE_LIVE}"
_JE_YEAR_END = f"posting_type = 'year_end' AND {_ONE_LIVE_ORIGINAL}"
_JE_GST_SETOFF = f"posting_type = 'gst_setoff' AND {_ONE_LIVE_ORIGINAL}"
_JE_OPENING = f"posting_type = 'opening' AND {_ONE_LIVE_ORIGINAL}"
JE_IDEMPOTENCY_INDEXES = (
    Index("uq_je_one_posting_per_document", "reference_document_type", "reference_document_id", unique=True,
          postgresql_where=text(_JE_ORIGINAL), sqlite_where=text(_JE_ORIGINAL)),
    Index("uq_je_one_reversal_per_entry", "reverses_journal_entry_id", unique=True,
          postgresql_where=text(_JE_REVERSAL), sqlite_where=text(_JE_REVERSAL)),
    # posting_date, not financial_year: the year-end voucher is always dated
    # the FY's last day, and financial_year is only filled in after the INSERT.
    Index("uq_je_one_year_end_per_fy", "posting_date", unique=True,
          postgresql_where=text(_JE_YEAR_END), sqlite_where=text(_JE_YEAR_END)),
    Index("uq_je_one_gst_setoff_per_period", "accounting_period", unique=True,
          postgresql_where=text(_JE_GST_SETOFF), sqlite_where=text(_JE_GST_SETOFF)),
    Index("uq_je_one_opening", "posting_type", unique=True,
          postgresql_where=text(_JE_OPENING), sqlite_where=text(_JE_OPENING)),
)


class JournalEntry(Base, TimestampMixin):
    """The only unit of double-entry posting in this module. Every later
    phase's post_vendor_invoice()/post_customer_invoice()/post_payroll() etc.
    creates one of these through accounts/service.py's post_journal_entry() —
    never inserted directly by a route. See
    old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 2."""

    __tablename__ = "journal_entries"
    __table_args__ = JE_IDEMPOTENCY_INDEXES

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # SM12 optimistic lock (core/optimistic_lock.py): bumped on every UPDATE;
    # a save carrying an older X-Lock-Version gets 409 "changed by X at T".
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    lock_changed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    __mapper_args__ = {"version_id_col": lock_version}
    # Voucher number — assigned when the entry is posted. A draft carries a
    # placeholder "DRAFT-<id>" so the unique constraint still holds.
    entry_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    voucher_type: Mapped[str] = mapped_column(String(20), nullable=False, default="journal")
    # FY code ("2026-27") the posting date falls in — see services/fiscal.py.
    financial_year: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    posting_date: Mapped[date] = mapped_column(Date, nullable=False)
    accounting_period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)  # "YYYY-MM"
    posting_type: Mapped[str] = mapped_column(String(30), nullable=False, default="adjustment")
    # Generic reference to whatever business document caused this posting
    # (a VendorInvoice, PaymentTransaction, ...) once those exist — unused
    # by this phase's manual entries.
    reference_document_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reference_document_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_debit: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    total_credit: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted")

    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    posted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Set on the ORIGINAL entry once reversed — the reversal itself is a
    # brand new JournalEntry, this entry is never edited/deleted.
    reversal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reversed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # Accrual-style entries: on posting, a reversal dated this day is posted
    # automatically (e.g. an expense accrued on 31-Mar reverses on 1-Apr).
    auto_reverse_on: Mapped[date | None] = mapped_column(Date, nullable=True)
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
    # KE5Z: derived at posting (accounts/services/profit_centers.py).
    profit_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("profit_centers.id"), index=True, nullable=True)
    # Which sub-ledger this line affects, once AP/AR exist (Phase 3/4) —
    # unused by this phase's manual entries.
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True)
    debit_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    credit_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    journal_entry: Mapped["JournalEntry"] = relationship("JournalEntry", back_populates="lines")
