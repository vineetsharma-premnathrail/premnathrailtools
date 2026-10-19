from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

CASH_FORECAST_DIRECTIONS = ("inflow", "outflow")
# Planning categories for flows the books can't predict on their own (SAP
# FF63 planning memo records).
CASH_FORECAST_CATEGORIES: dict[str, str] = {
    "salaries": "Salaries & wages",
    "statutory": "GST / TDS / PF / ESI payments",
    "loan": "Loan EMI / interest",
    "rent_utilities": "Rent & utilities",
    "capex": "Capital expenditure",
    "tax": "Advance income tax",
    "other_outflow": "Other planned payment",
    "loan_inflow": "Loan / capital inflow",
    "other_inflow": "Other planned receipt",
}
# none = one date only; weekly / monthly repeat until end_date (or the end of
# the forecast horizon).
CASH_FORECAST_RECURRENCES = ("none", "weekly", "monthly")


class CashForecastItem(Base, TimestampMixin):
    """A planned cash flow entered by Finance (salaries, GST, loan EMIs...).
    Read-only input to the cash position — it never posts to the ledger."""

    __tablename__ = "accounts_cash_forecast_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[float] = mapped_column(Money, nullable=False)
    expected_date: Mapped[date] = mapped_column(Date, nullable=False)
    recurrence: Mapped[str] = mapped_column(String(10), nullable=False, default="none")
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    bank_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("bank_accounts.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
