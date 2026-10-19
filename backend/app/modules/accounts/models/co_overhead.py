"""CO overhead calculation (SAP KGI2 / KGI4) with a costing sheet.

The costing sheet's structure is coded: two overhead rows, a % on material
and a % on labour/machine cost. Its percentages are Finance data, per plant
(branch) with a validity window; a row with no plant applies to every plant
that has none of its own. At period end the overhead run applies the sheet
to each work order's material and labour of that period, writing an
'overhead' cost posting on the order, so overhead is part of the order's
actual cost and of WIP (AS-2 allows production overheads). Product cost
estimates use the same sheet. Periodic inventory: nothing here posts to
the GL."""
from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money, Percent


class CoCostingSheetRate(Base, TimestampMixin):
    __tablename__ = "co_costing_sheet_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    material_overhead_pct: Mapped[float] = mapped_column(Percent, nullable=False, default=0)
    labour_overhead_pct: Mapped[float] = mapped_column(Percent, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class CoOverheadRun(Base, TimestampMixin):
    __tablename__ = "co_overhead_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    accounting_period: Mapped[str] = mapped_column(String(7), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted")
    total_overhead: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    run_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reversed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    lines: Mapped[list["CoOverheadRunLine"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class CoOverheadRunLine(Base, TimestampMixin):
    __tablename__ = "co_overhead_run_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("co_overhead_runs.id", ondelete="CASCADE"), index=True, nullable=False)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_work_orders.id"), index=True, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    costing_sheet_rate_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("co_costing_sheet_rates.id"), nullable=True)
    material_base: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    labour_base: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    material_overhead_pct: Mapped[float] = mapped_column(Percent, nullable=False, default=0)
    labour_overhead_pct: Mapped[float] = mapped_column(Percent, nullable=False, default=0)
    material_overhead: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    labour_overhead: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    cost_posting_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_order_cost_postings.id"), nullable=True)
    reversal_posting_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_order_cost_postings.id"), nullable=True)

    run: Mapped[CoOverheadRun] = relationship(back_populates="lines")
