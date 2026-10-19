from __future__ import annotations
from sqlalchemy import String, Integer, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

GL_ACCOUNT_TYPES = ("asset", "liability", "equity", "revenue", "expense")
GL_ACCOUNT_STATUSES = ("active", "inactive")


class GLAccount(Base, TimestampMixin):
    """A ledger in the chart of accounts — the only thing a journal line can
    post to. See old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 1.

    `account_type` always equals its group's `nature` (enforced by the route
    and by the account-groups migration), so existing code that branches on
    account_type keeps working."""

    __tablename__ = "gl_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    account_type: Mapped[str] = mapped_column(String(20), nullable=False)
    group_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("account_groups.id"), nullable=True, index=True)
    account_sub_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True, default="INR")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    # Legacy, informational only — never read by the ledger. Opening balances
    # are posted as an Opening Balance voucher (services/opening.py) so they
    # are dated, balanced and auditable like every other figure in the books.
    opening_balance: Mapped[float | None] = mapped_column(Money, nullable=True, default=0)
    # Only a posting account can receive journal-entry lines directly (a
    # group/header account like "Current Assets" never does) — enforced by
    # post_journal_entry().
    is_posting_account: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # AP/AR control accounts reconcile against a sub-ledger (Vendor/Customer
    # balances): a manual journal line on one must name the party.
    is_control_account: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Controlling (services/controlling.py): a manual journal / purchase
    # invoice / expense payment line on this ledger must carry a cost centre
    # or an internal order (SAP field status "cost object required").
    cost_object_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    # Filled in when a line on this ledger has no cost centre (SAP OKB9).
    default_cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True)
