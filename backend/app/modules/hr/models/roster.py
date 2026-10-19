"""Shift planning (SAP PT01 / OP4A work schedule + PEM-style shift roster).

- HrShiftPattern: a rotation, e.g. "A-B-C weekly rotation" = 21 days
  [A×6, off, B×6, off, C×6, off] or "General, Sunday off" = 7 days.
  `pattern` is a JSON list, one entry per cycle day: a shift CODE, or "off".
- HrShiftRoster: the dated plan — one row per employee per day with a
  shift and/or a weekly off. Rows come from manual edits, a CSV upload or
  generating a pattern over a date range.

Precedence when attendance / time evaluation asks "which shift on date X":
the attendance row's own shift_id (what was actually worked) → the roster
row → the employee profile's default shift. Weekly off: the roster row's
is_weekly_off overrides the plant's working days for that date.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

ROSTER_SOURCES = ("manual", "import", "pattern")
PATTERN_OFF = "off"


class HrShiftPattern(Base, TimestampMixin):
    __tablename__ = "hr_shift_patterns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    cycle_days: Mapped[int] = mapped_column(Integer, nullable=False)
    pattern: Mapped[list] = mapped_column(JSON, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class HrShiftRoster(Base, TimestampMixin):
    __tablename__ = "hr_shift_roster"
    __table_args__ = (UniqueConstraint("user_id", "roster_date", name="uq_hr_shift_roster_user_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    roster_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("hr_shifts.id"), nullable=True)
    is_weekly_off: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual", nullable=False)
    pattern_id: Mapped[int | None] = mapped_column(ForeignKey("hr_shift_patterns.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
