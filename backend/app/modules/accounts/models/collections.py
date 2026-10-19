"""Receivables management (SAP FSCM): credit management, collections /
dunning, and dispute management.

  AccountsCreditRelease   FD32 / UKM credit block release — a sales order
                          confirmation or a dispatch stopped by the credit
                          check (exposure over the limit, or invoices overdue
                          beyond the customer's credit days) can go ahead only
                          after a Finance approver releases it through the
                          central approval engine (accounts.credit_release).
  AccountsCollectionNote  FSCM Collections contact log — calls, e-mails,
                          visits, reminders sent and promises to pay (with
                          the follow-up date the collector is reminded on).
  AccountsDunningLetter   F150 dunning notice — one per customer per dunning
                          run, listing the overdue invoices and the level each
                          reached; a managed Word document (Save & Edit in
                          Word), PDF only as a fallback.
  AccountsDispute         FSCM Dispute Management (UDM) — a disputed amount on
                          a posted sales invoice. Open disputes are shown
                          apart in aging and left out of dunning and of the
                          overdue credit block; they are resolved by a credit
                          note, a write-off, or the customer paying.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

# ── Credit management ────────────────────────────────────────────────────

CREDIT_CHECKPOINTS = {"so_confirmation": "Sales order confirmation", "dispatch": "Dispatch"}
# pending_approval -> released | rejected (withdrawn = requester cancelled)
CREDIT_RELEASE_STATUSES = ("pending_approval", "released", "rejected", "withdrawn")


class AccountsCreditRelease(Base, TimestampMixin):
    __tablename__ = "accounts_credit_releases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    release_number: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), index=True, nullable=False)
    # The order the release is for (None = any order of the customer).
    sales_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_orders.id"), index=True, nullable=True)
    checkpoint: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending_approval")
    # Snapshot of the credit position when the release was asked for.
    credit_limit: Mapped[float | None] = mapped_column(Money, nullable=True)
    exposure: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    overdue_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    max_days_overdue: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    block_reasons: Mapped[str] = mapped_column(Text, nullable=False)
    request_reason: Mapped[str] = mapped_column(Text, nullable=False)
    requested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A released block stays released for this checkpoint until this date.
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)


# ── Collections ──────────────────────────────────────────────────────────

COLLECTION_NOTE_TYPES = {
    "call": "Phone call", "email": "E-mail", "visit": "Visit / meeting", "promise_to_pay": "Promise to pay",
    "reminder_sent": "Reminder letter sent", "note": "Note",
}
# open -> kept | broken (checked against receipts after the promised date) | cancelled
PROMISE_STATUSES = ("open", "kept", "broken", "cancelled")


class AccountsCollectionNote(Base, TimestampMixin):
    __tablename__ = "accounts_collection_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), index=True, nullable=False)
    ar_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ar_transactions.id"), index=True, nullable=True)
    note_type: Mapped[str] = mapped_column(String(20), nullable=False)
    note_date: Mapped[date] = mapped_column(Date, nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    remarks: Mapped[str] = mapped_column(Text, nullable=False)
    promised_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    promised_amount: Mapped[float | None] = mapped_column(Money, nullable=True)
    promise_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Received against the promise when it was last checked.
    promise_received: Mapped[float | None] = mapped_column(Money, nullable=True)
    follow_up_date: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)
    # Set once the collector has been reminded of the follow-up (daily job).
    follow_up_reminded_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    dunning_letter_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts_dunning_letters.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


DUNNING_LETTER_STATUSES = ("issued", "cancelled")


class AccountsDunningLetter(Base, TimestampMixin):
    __tablename__ = "accounts_dunning_letters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    letter_number: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), index=True, nullable=False)
    letter_date: Mapped[date] = mapped_column(Date, nullable=False)
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    dunning_level: Mapped[int] = mapped_column(Integer, nullable=False)
    total_overdue: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    # [{ar_transaction_id, invoice_number, invoice_date, due_date, days_overdue, amount_due, disputed, level, previous_level}]
    items: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="issued")
    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


# ── Disputes ─────────────────────────────────────────────────────────────

DISPUTE_REASONS = {
    "quality": "Quality claim", "quantity": "Quantity / short supply", "price": "Price / rate",
    "ld": "LD (liquidated damages)", "documentation": "Documentation (missing / wrong papers)", "other": "Other",
}
DISPUTE_STATUSES = {
    "open": "Open", "under_review": "Under review", "resolved_credit_note": "Resolved — credit note",
    "resolved_paid": "Resolved — customer paid", "written_off": "Resolved — written off",
}
DISPUTE_OPEN_STATUSES = ("open", "under_review")


class AccountsDispute(Base, TimestampMixin):
    __tablename__ = "accounts_disputes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dispute_number: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), index=True, nullable=False)
    ar_transaction_id: Mapped[int] = mapped_column(Integer, ForeignKey("ar_transactions.id"), index=True, nullable=False)
    disputed_amount: Mapped[float] = mapped_column(Money, nullable=False)
    reason: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="open", index=True)
    raised_on: Mapped[date] = mapped_column(Date, nullable=False)
    owner_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # Optional link to the Quality customer complaint behind a quality claim.
    customer_complaint_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolved_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    resolved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    party_note_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts_party_notes.id"), nullable=True)
    settlement_adjustment_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts_settlement_adjustments.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
