from __future__ import annotations
from sqlalchemy import String, Integer, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

GROUP_NATURES = ("asset", "liability", "equity", "revenue", "expense")

# Schedule III (Companies Act 2013, Division I) line items a group rolls up
# into. Balance Sheet heads first, then Statement of Profit & Loss heads.
SCHEDULE_III_BS_HEADS = {
    "share_capital": "Share Capital",
    "reserves_surplus": "Reserves and Surplus",
    "long_term_borrowings": "Long-term Borrowings",
    "long_term_provisions": "Long-term Provisions",
    "short_term_borrowings": "Short-term Borrowings",
    "trade_payables": "Trade Payables",
    "other_current_liabilities": "Other Current Liabilities",
    "short_term_provisions": "Short-term Provisions",
    "ppe": "Property, Plant and Equipment",
    "non_current_investments": "Non-current Investments",
    "long_term_loans_advances": "Long-term Loans and Advances",
    "current_investments": "Current Investments",
    "inventories": "Inventories",
    "trade_receivables": "Trade Receivables",
    "cash_equivalents": "Cash and Cash Equivalents",
    "short_term_loans_advances": "Short-term Loans and Advances",
    "other_current_assets": "Other Current Assets",
}
SCHEDULE_III_PL_HEADS = {
    "revenue_from_operations": "Revenue from Operations",
    "other_income": "Other Income",
    "cost_of_materials_consumed": "Cost of Materials Consumed",
    "changes_in_inventories": "Changes in Inventories",
    "employee_benefits": "Employee Benefits Expense",
    "finance_costs": "Finance Costs",
    "depreciation": "Depreciation and Amortisation Expense",
    "other_expenses": "Other Expenses",
    "tax_expense": "Tax Expense",
}
SCHEDULE_III_HEADS = {**SCHEDULE_III_BS_HEADS, **SCHEDULE_III_PL_HEADS}


class AccountGroup(Base, TimestampMixin):
    """A node in the chart-of-accounts tree (Tally's "group", SAP's account
    group). Ledgers (GLAccount rows) hang off a group; reports roll ledgers up
    through their group's `schedule_iii_head`, so a new ledger lands on the
    right line of the Balance Sheet / P&L just by picking its group.

    `nature` must match the parent's — a sub-group of Current Assets can't be
    a liability. `affects_gross_profit` marks Trading-account groups (Sales,
    Purchases, Direct Expenses/Incomes) for the gross-profit subtotal.
    System groups (seeded) can be renamed but not deleted or re-parented."""

    __tablename__ = "account_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("account_groups.id"), nullable=True)
    nature: Mapped[str] = mapped_column(String(20), nullable=False)
    schedule_iii_head: Mapped[str] = mapped_column(String(40), nullable=False)
    affects_gross_profit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
