from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class CostCenter(Base, TimestampMixin):
    __tablename__ = "cost_centers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    cost_center_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    department_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("departments.id"), nullable=True)
    head_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    parent_cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active")

    # Accounts module — see old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 1.
    # Kept on this existing master rather than a competing accounts-owned
    # CostCenter table.
    annual_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    budget_period: Mapped[str | None] = mapped_column(String(7), nullable=True)  # "YYYY-MM"
    gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
