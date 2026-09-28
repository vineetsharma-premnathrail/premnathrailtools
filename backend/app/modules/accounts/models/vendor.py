from __future__ import annotations
from sqlalchemy import String, Integer, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

VENDOR_STATUSES = ("active", "inactive", "blocked")


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

    credit_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    payment_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    early_payment_discount_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    gl_reconciliation_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
