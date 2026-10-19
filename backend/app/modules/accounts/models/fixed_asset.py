from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Text, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money, Percent, Quantity

# SLM — straight line: (cost - residual) / useful life, same every month.
# WDV — written-down value: opening book value x annual rate, so the charge
#       falls each year. Companies Act 2013 Schedule II allows either; the
#       Income-tax block-of-assets calculation is separate and not done here.
DEPRECIATION_METHODS = ("slm", "wdv")
FIXED_ASSET_STATUSES = ("active", "disposed")
DEPRECIATION_RUN_STATUSES = ("posted", "reversed")


class FixedAsset(Base, TimestampMixin):
    """Fixed-asset register entry. The purchase itself is booked through a
    purchase invoice to the asset's cost ledger (asset_gl_account_id); this
    register tracks life, depreciation and disposal. Depreciation is charged
    from put_to_use_date, pro-rata by days in the first month, never past
    cost - residual_value. `accumulated_depreciation` is the running total of
    posted depreciation runs plus any opening figure for an asset brought in
    from older books."""

    __tablename__ = "accounts_fixed_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    asset_gl_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=False)
    accumulated_depreciation_gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
    depreciation_expense_gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    vendor_invoice_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendor_invoices.id"), nullable=True)
    location: Mapped[str | None] = mapped_column(String(150), nullable=True)

    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    put_to_use_date: Mapped[date] = mapped_column(Date, nullable=False)
    cost: Mapped[float] = mapped_column(Money, nullable=False)
    residual_value: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    depreciation_method: Mapped[str] = mapped_column(String(10), nullable=False, default="slm")
    useful_life_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    wdv_rate_pct: Mapped[float | None] = mapped_column(Percent, nullable=True)
    opening_accumulated_depreciation: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    accumulated_depreciation: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    depreciated_up_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    disposal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    disposal_proceeds: Mapped[float | None] = mapped_column(Money, nullable=True)
    disposal_journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Integrated acquisition (ABZON / F-90) — services/asset_accounting.py.
    # vendor_invoice_line_id: the posted purchase-invoice line on a fixed-asset
    # ledger this asset was capitalised from (no new journal — the bill
    # already debited the asset ledger). internal_order_id: the capital order
    # (CWIP) settled into it by capitalisation_journal_entry_id.
    vendor_invoice_line_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendor_invoice_lines.id"), nullable=True, index=True)
    internal_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("internal_orders.id"), nullable=True, index=True)
    capitalisation_journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    # Units held (partial retirement by quantity) and the cost at acquisition
    # (cost falls with each partial retirement; the Income-tax block needs the
    # original addition).
    quantity: Mapped[float] = mapped_column(Quantity, nullable=False, default=1, server_default="1")
    original_cost: Mapped[float | None] = mapped_column(Money, nullable=True)
    # Income-tax Act block of assets (parallel tax depreciation, report only).
    it_block_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts_it_asset_blocks.id"), nullable=True, index=True)


class DepreciationRun(Base, TimestampMixin):
    """One month's depreciation across every active asset. At most one
    *posted* run per period (enforced in services/assets.py); a reversed run
    stays for the audit trail and the month can be run again."""

    __tablename__ = "accounts_depreciation_runs"
    # Database backstop for the one-posted-run rule (migration b7d3f1a9c2e4).
    __table_args__ = (
        Index("uq_depreciation_run_one_posted_per_period", "accounting_period", unique=True,
              postgresql_where=text("status = 'posted'"), sqlite_where=text("status = 'posted'")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    accounting_period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted")
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    lines: Mapped[list["DepreciationRunLine"]] = relationship(
        "DepreciationRunLine", back_populates="run", cascade="all, delete-orphan",
    )


class DepreciationRunLine(Base, TimestampMixin):
    __tablename__ = "accounts_depreciation_run_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    depreciation_run_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts_depreciation_runs.id"), nullable=False, index=True)
    fixed_asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts_fixed_assets.id"), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Money, nullable=False)
    book_value_before: Mapped[float] = mapped_column(Money, nullable=False)
    days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Restored onto the asset if this run is reversed.
    previous_depreciated_up_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    run: Mapped["DepreciationRun"] = relationship("DepreciationRun", back_populates="lines")


# accounts_fixed_assets.it_block_id references this module's tables —
# register them with the metadata whenever FixedAsset is imported.
from app.modules.accounts.models import asset_accounting as _asset_accounting  # noqa: E402,F401
