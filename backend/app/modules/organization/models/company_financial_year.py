from __future__ import annotations
from sqlalchemy import String, Integer, Date, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class CompanyFinancialYear(Base, TimestampMixin):
    __tablename__ = "company_financial_years"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    start_date: Mapped[Date] = mapped_column(Date, nullable=False)
    end_date: Mapped[Date] = mapped_column(Date, nullable=False)
    fiscal_year_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="open")
    lock_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    period_closing_rule: Mapped[str | None] = mapped_column(String(150), nullable=True)
    number_series_reset: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
