from __future__ import annotations
from sqlalchemy import String, Integer, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

BANK_ACCOUNT_STATUSES = ("active", "inactive", "closed")


class BankAccount(Base, TimestampMixin):
    """A company bank account. `current_balance` starts equal to
    `opening_balance` and is only ever recomputed from posted transactions
    once Phase 2 (Ledger Engine) exists — never hand-edited, same rule as
    Store's StockBalance."""

    __tablename__ = "bank_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bank_name: Mapped[str] = mapped_column(String(150), nullable=False)
    account_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    account_holder_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    branch_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    ifsc_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True, default="INR")
    opening_balance: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    current_balance: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
