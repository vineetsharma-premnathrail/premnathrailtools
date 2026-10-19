"""Generated statutory registers (Factories Act 1948 + State Factories Rules).

A row is the anchor of one managed Word document (main/models/
managed_document.py): register type + plant + period. Regenerating after
the underlying data changed bumps `revision`, which makes the managed
document framework offer a fresh draft.

  form12        Register of adult workers (s.62, Form 12)
  form25        Muster roll (Form 25) — monthly, daily status codes + OT
  leave_register Register of leave with wages (s.79/80, Form 14) — yearly
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

REGISTER_TYPES = {
    "form12": "Form 12 — Register of adult workers",
    "form25": "Form 25 — Muster roll",
    "leave_register": "Form 14 — Register of leave with wages",
}


class HrStatutoryRegister(Base, TimestampMixin):
    __tablename__ = "hr_statutory_registers"
    __table_args__ = (UniqueConstraint("register_type", "branch_id", "year", "month", name="uq_hr_statutory_register"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    register_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id"), index=True, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    # 0 for yearly / as-of registers (Form 12, leave register): NULLs would
    # defeat the unique constraint.
    month: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    generated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
