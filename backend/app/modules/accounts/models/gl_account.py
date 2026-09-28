from __future__ import annotations
from sqlalchemy import String, Integer, Float, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

GL_ACCOUNT_TYPES = ("asset", "liability", "equity", "revenue", "expense")
GL_ACCOUNT_STATUSES = ("active", "inactive")


class GLAccount(Base, TimestampMixin):
    """Chart of accounts — the only master this whole module (and every
    later phase's posting logic) keys off. See
    old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 1."""

    __tablename__ = "gl_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    account_type: Mapped[str] = mapped_column(String(20), nullable=False)
    account_sub_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True, default="INR")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    opening_balance: Mapped[float | None] = mapped_column(Float, nullable=True, default=0)
    # Only a posting account can receive journal-entry lines directly (a
    # group/header account like "Current Assets" never does) — enforced by
    # Phase 2's posting functions, not by this table.
    is_posting_account: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # AP/AR control accounts reconcile against a sub-ledger (Vendor/Customer
    # balances) rather than being posted to directly by manual entries.
    is_control_account: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
