"""Profit centre master (SAP KE51 / KE52 / KE53).

A profit centre is a slice of the business that earns and spends on its own:
a plant, or a business line inside a plant — new machines, service, spares.
Every journal line carries one, derived at posting
(accounts/services/profit_centers.py): explicit on the line > the cost
centre's > the internal order's cost centre's > the sales order / service
request behind the document (plant + business line) > the company default.
That gives a plant-wise and business-line P&L straight from the books."""
from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

PROFIT_CENTER_SEGMENTS = ("machines", "service", "spares", "corporate")
PROFIT_CENTER_SEGMENT_LABELS = {
    "machines": "New machines", "service": "Service", "spares": "Spares", "corporate": "Corporate / common",
}
PROFIT_CENTER_STATUSES = ("active", "inactive")


class ProfitCenter(Base, TimestampMixin):
    __tablename__ = "profit_centers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    segment: Mapped[str] = mapped_column(String(20), default="corporate", nullable=False)
    # Branch = "Plant" in the UI. NULL = company-wide.
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("profit_centers.id"), nullable=True)
    person_responsible_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    # The company's catch-all ("dummy") profit centre — lines nothing else
    # derives a profit centre for land here. At most one.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
