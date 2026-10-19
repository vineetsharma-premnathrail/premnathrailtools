"""CO assessment and distribution cycles (SAP KSU5 / KSV5).

A cycle moves the period's actual cost of sender cost centres onto receiver
cost centres. The methods and bases are coded; the cycles themselves
(which senders, which ledgers, which receivers) are Finance data.
  distribution  credits each sender ledger on the sender cost centre and
                debits the same ledger on the receivers;
  assessment    does the same on one assessment ledger (secondary cost).
The P&L total never changes, only which cost centre carries the cost.
Each run posts one journal (posting_type 'co_allocation'); undoing a run
reverses that journal."""
from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

CO_ALLOCATION_METHODS = {"distribution": "Distribution (same ledger)", "assessment": "Assessment (assessment ledger)"}
CO_ALLOCATION_BASES = {
    "fixed_percent": "Fixed percentages",
    "headcount": "Headcount (active users of the receiver's department)",
    "activity_hours": "Activity hours (time logs on the receiver's workstations)",
}
CO_ALLOCATION_RUN_STATUSES = ("posted", "reversed")


class CoAllocationCycle(Base, TimestampMixin):
    __tablename__ = "co_allocation_cycles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    method: Mapped[str] = mapped_column(String(20), nullable=False, default="distribution")
    assessment_gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    segments: Mapped[list["CoAllocationSegment"]] = relationship(
        back_populates="cycle", cascade="all, delete-orphan", order_by="CoAllocationSegment.sequence")


class CoAllocationSegment(Base, TimestampMixin):
    __tablename__ = "co_allocation_segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cycle_id: Mapped[int] = mapped_column(Integer, ForeignKey("co_allocation_cycles.id", ondelete="CASCADE"), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    sender_cost_center_id: Mapped[int] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=False)
    # GL ids whose actuals are sent; empty = every expense ledger on the sender.
    sender_gl_account_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    basis: Mapped[str] = mapped_column(String(20), nullable=False, default="fixed_percent")
    # activity_hours only: count just this activity type (MCH/LAB/SET); null = all.
    activity_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # [{"cost_center_id": int, "percent": float}] — percent is used by fixed_percent only.
    receivers: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    cycle: Mapped[CoAllocationCycle] = relationship(back_populates="segments")


class CoAllocationRun(Base, TimestampMixin):
    __tablename__ = "co_allocation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cycle_id: Mapped[int] = mapped_column(Integer, ForeignKey("co_allocation_cycles.id"), index=True, nullable=False)
    accounting_period: Mapped[str] = mapped_column(String(7), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted")
    total_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    reversal_journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    # The preview the run posted: senders, bases, shares, amounts.
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    run_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reversed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
