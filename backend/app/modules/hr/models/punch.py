"""Raw time events from biometric terminals (SAP PT_ERL00 / CC1 upload).

Every punch is kept as loaded (one row per employee per timestamp — the
same punch loaded twice is a duplicate and skipped). Evaluation
(services/punches.derive_day) turns a day's punches into the attendance
row: first IN = check-in, last OUT = check-out, inside the shift window
(night shifts span midnight). Exceptions (single punch, IN without OUT,
duplicate within the debounce window) are listed, never guessed.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

PUNCH_DIRECTIONS = ("in", "out")
PUNCH_SOURCES = ("biometric", "manual")


class HrPunch(Base, TimestampMixin):
    __tablename__ = "hr_punches"
    __table_args__ = (UniqueConstraint("user_id", "punched_at", name="uq_hr_punch_user_time"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    punched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    direction: Mapped[str | None] = mapped_column(String(5), nullable=True)
    device_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="biometric", server_default="biometric", nullable=False)
    import_batch: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
