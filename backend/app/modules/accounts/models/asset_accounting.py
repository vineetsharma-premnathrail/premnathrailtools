"""Asset accounting beyond the register itself: retirements (ABAVN scrap /
ABAON sale, full or partial) and the Income-tax Act block of assets used for
the parallel tax depreciation area (Sec 32, Form 3CD clause 18)."""
from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Boolean, Date, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money, Percent, Quantity

# scrap — written off with no buyer (ABAVN); any scrap value is still a sale.
# sale  — sold to a customer: a GST tax invoice is raised to the buyer and its
#         revenue line credits the asset-sale clearing ledger (ABAON).
RETIREMENT_TYPES = ("scrap", "sale")
RETIREMENT_STATUSES = ("posted", "reversed")


class AssetRetirement(Base, TimestampMixin):
    """One retirement of all or part of an asset. The journal (Dr accumulated
    depreciation, Dr clearing for the sale value, Cr asset cost, gain/loss to
    the disposal ledgers) is posted at once; the sale invoice to the buyer is
    a normal draft sales invoice (maker-checker) whose revenue line clears the
    clearing ledger when it is posted."""

    __tablename__ = "accounts_asset_retirements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fixed_asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts_fixed_assets.id"), nullable=False, index=True)
    retirement_date: Mapped[date] = mapped_column(Date, nullable=False)
    retirement_type: Mapped[str] = mapped_column(String(10), nullable=False)
    # Share of the asset retired: percent of cost (100 = full), or the
    # quantity retired out of the units held.
    retire_percent: Mapped[float] = mapped_column(Percent, nullable=False)
    retire_quantity: Mapped[float | None] = mapped_column(Quantity, nullable=True)
    catch_up_depreciation: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    retired_cost: Mapped[float] = mapped_column(Money, nullable=False)
    retired_accumulated_depreciation: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    sale_value: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    gain_loss: Mapped[float] = mapped_column(Money, nullable=False, default=0)  # + gain, - loss
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True)
    gst_rate: Mapped[float | None] = mapped_column(Percent, nullable=True)
    hsn_sac_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    ar_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ar_transactions.id"), nullable=True)
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted")
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class ITAssetBlock(Base, TimestampMixin):
    """A block of assets under the Income-tax Act (Sec 2(11), Rule 5 /
    Appendix I) — e.g. Plant & Machinery (general) 15%, Computers 40%.
    Depreciation is on the block's WDV, never per asset."""

    __tablename__ = "accounts_it_asset_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    rate_pct: Mapped[float] = mapped_column(Percent, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ITBlockBalance(Base, TimestampMixin):
    """Opening tax WDV of a block for a financial year, entered once (from
    the last tax audit report) for the first year the portal computes;
    later years carry the computed closing WDV forward."""

    __tablename__ = "accounts_it_block_balances"
    __table_args__ = (UniqueConstraint("block_id", "fy_code", name="uq_it_block_balance_block_fy"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    block_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts_it_asset_blocks.id"), nullable=False, index=True)
    fy_code: Mapped[str] = mapped_column(String(20), nullable=False)
    opening_wdv: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
