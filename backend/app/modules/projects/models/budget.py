from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class PmBudgetLine(Base, TimestampMixin):
    """A budgeted cost category within a Project Management module project.
    Table `pm_project_budget_lines`, FK'd to `pm_projects.id`. Spent/remaining
    amounts are not stored — computed by the route from `PmCostEntry` rows."""

    __tablename__ = "pm_project_budget_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(150), nullable=False)
    budgeted_amount: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class PmCostEntry(Base, TimestampMixin):
    """An actual cost recorded against a project (optionally against a
    specific `PmBudgetLine`). Table `pm_project_cost_entries`, FK'd to
    `pm_projects.id`, `pm_project_budget_lines.id`, and `users.id`."""

    __tablename__ = "pm_project_cost_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    budget_line_id: Mapped[int | None] = mapped_column(ForeignKey("pm_project_budget_lines.id"), nullable=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    cost_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
