from __future__ import annotations
from datetime import date
from sqlalchemy import Date, String, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money, Percent

VENDOR_STATUSES = ("active", "inactive", "blocked")
GST_REGISTRATION_TYPES = ("regular", "composition", "unregistered", "overseas", "sez")


class Vendor(Base, TimestampMixin):
    """Vendor master, owned by Accounts. Not an extension of an existing
    table — no vendor master existed anywhere in this codebase before this
    (P2P only ever stored a vendor as free text; see
    old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 1 for that finding).
    Wiring P2P's free-text vendor fields to this master is a P2P-side
    follow-up, not done here."""

    __tablename__ = "vendors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pan: Mapped[str | None] = mapped_column(String(15), nullable=True)
    # Drives input-tax eligibility: a composition or unregistered supplier
    # charges no GST, so their bill carries no input credit.
    gst_registration_type: Mapped[str] = mapped_column(String(20), nullable=False, default="regular")
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pin_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(150), nullable=True)

    bank_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    bank_account_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ifsc_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    account_holder_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    credit_limit: Mapped[float | None] = mapped_column(Money, nullable=True)
    payment_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    early_payment_discount_pct: Mapped[float | None] = mapped_column(Percent, nullable=True)
    # Pre-fills the ledger on a direct (non-PO) purchase invoice line.
    default_expense_gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
    gl_reconciliation_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

    # MSME (MSMED Act 2006 / Udyam registration). Micro and small suppliers
    # must be paid within the agreed days, at most 45 days from acceptance
    # (15 days when nothing is agreed) — sec. 15; unpaid beyond that at year
    # end is disallowed under Income-tax sec. 43B(h) (micro / small only, not
    # traders). See accounts/services/msme.py.
    msme_category: Mapped[str | None] = mapped_column(String(10), nullable=True)  # micro / small / medium
    udyam_number: Mapped[str | None] = mapped_column(String(25), nullable=True)
    msme_activity: Mapped[str | None] = mapped_column(String(15), nullable=True)  # manufacturing / services / trader
    msme_valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Procurement (2026-10-07): the same master is managed from Procurement →
    # Vendors; RFQ vendor slots and POs link here (vendor_id), so a vendor
    # invoice matches the PO's vendor. Documents and catalog items are their
    # own tables (vendor_document.py / vendor_catalog_item.py).
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    terms_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
