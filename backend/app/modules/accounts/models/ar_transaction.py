from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

AR_COLLECTION_STATUSES = ("pending", "partial", "collected", "overdue")
AR_TRANSACTION_STATUSES = ("pending", "posted", "cancelled")


class ARTransaction(Base, TimestampMixin):
    """A customer invoice we raise (mirror of AP's VendorInvoice, but this
    invoice_number is system-generated — it's ours, not the customer's).
    No 3-way-match/variance concept — unlike a P2P PO/GRN pair, no CRM
    entity gives a consistent structured "amount to invoice", so the
    Accounts user enters the amount and revenue GL account directly. See
    old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 4."""

    __tablename__ = "ar_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    invoice_amount: Mapped[float] = mapped_column(Float, nullable=False)
    gst_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    discount_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(Float, nullable=False)
    revenue_gl_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=False)

    # Purely informational — free text, not validated against the source
    # table (no consistent CRM "sale" entity to validate against; see the
    # Phase 4 plan's research note).
    reference_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reference_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    amount_received: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    amount_due: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    collection_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # Informational only, manually incremented — no automatic dunning
    # letters (explicitly out of scope, see the design doc).
    dunning_level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
