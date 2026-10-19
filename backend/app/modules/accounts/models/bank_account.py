from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

BANK_ACCOUNT_STATUSES = ("active", "inactive", "closed")
# "cash" = a cash box / petty cash; it has no bank fields and can never go
# negative (see services/vouchers.py).
BANK_ACCOUNT_KINDS = ("bank", "cash")


class BankAccount(Base, TimestampMixin):
    """A company bank or cash account, always linked to its own GL ledger.

    The balance shown anywhere is the linked GL ledger's balance (see
    services/balances.py) — `current_balance` is a legacy column kept only so
    old rows still load; nothing writes it any more, so the ledger is the
    single source of truth. `opening_balance` is likewise informational: the
    real opening figure is posted through the Opening Balance voucher."""

    __tablename__ = "bank_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_kind: Mapped[str] = mapped_column(String(10), nullable=False, default="bank")
    # For a cash account this holds its display name (e.g. "Petty Cash — Plant").
    bank_name: Mapped[str] = mapped_column(String(150), nullable=False)
    account_no: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    account_holder_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    branch_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    ifsc_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True, default="INR")
    opening_balance: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    current_balance: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
