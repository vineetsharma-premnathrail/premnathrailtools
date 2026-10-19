from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Boolean, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money
from app.modules.accounts.models.tax_line import TaxLineMixin

# debit_note  — issued TO a vendor: purchase return / rate reduction. Reduces
#               what we owe and reverses the input GST taken on the bill.
# credit_note — issued TO a customer: sales return / rate reduction. Reduces
#               what they owe and reduces our output GST (reported in GSTR-1
#               CDNR/CDNUR, which needs the original invoice — so a credit
#               note must reference one).
PARTY_NOTE_TYPES = ("debit_note", "credit_note")
PARTY_NOTE_REASONS = ("return", "rate_difference", "discount", "deficiency", "other")
PARTY_NOTE_STATUSES = ("pending", "posted", "cancelled")


class PartyNote(Base, TimestampMixin):
    """A debit note (vendor side) or credit note (customer side). Posts the
    mirror of the original invoice for the returned value, then adjusts the
    original invoice's amount due (or sits as an open credit on the party if
    it isn't linked to one)."""

    __tablename__ = "accounts_party_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    note_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    note_type: Mapped[str] = mapped_column(String(20), nullable=False)
    note_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(String(30), nullable=False, default="return")

    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True)
    vendor_invoice_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendor_invoices.id"), nullable=True)
    ar_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ar_transactions.id"), nullable=True)

    party_gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    place_of_supply_state_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    is_interstate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    taxable_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    cgst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    sgst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    igst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    gst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    round_off: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    # Portion of total_amount not yet set off against an invoice.
    unadjusted_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)

    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    lines: Mapped[list["PartyNoteLine"]] = relationship(
        "PartyNoteLine", back_populates="note", cascade="all, delete-orphan", order_by="PartyNoteLine.line_number",
    )


class PartyNoteLine(Base, TimestampMixin, TaxLineMixin):
    __tablename__ = "accounts_party_note_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    party_note_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts_party_notes.id"), nullable=False, index=True)

    note: Mapped["PartyNote"] = relationship("PartyNote", back_populates="lines")
