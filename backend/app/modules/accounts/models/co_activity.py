"""CO activity types and activity prices (SAP KL01 / KP26).

The activity types are coded (not a configurable master): machine hour,
labour hour and setup hour. Their prices are data — one rate per FY and
validity window, for a workstation or for the cost centre that runs it,
split into a fixed and a variable part. Production time logs are costed
with the rate valid on the log date (services/co_activity.py)."""
from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Rate

# code -> (label, unit)
CO_ACTIVITY_TYPES: dict[str, tuple[str, str]] = {
    "MCH": ("Machine hour", "H"),
    "LAB": ("Labour hour", "H"),
    "SET": ("Setup hour", "H"),
}


class CoActivityRate(Base, TimestampMixin):
    __tablename__ = "co_activity_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_type: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    # Exactly one of the two: a workstation's own rate wins over its cost centre's.
    workstation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_workstations.id"), index=True, nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), index=True, nullable=True)
    financial_year: Mapped[str] = mapped_column(String(10), nullable=False)
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    fixed_rate: Mapped[float] = mapped_column(Rate, nullable=False, default=0)
    variable_rate: Mapped[float] = mapped_column(Rate, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    @property
    def rate(self) -> float:
        return round(float(self.fixed_rate or 0) + float(self.variable_rate or 0), 4)
