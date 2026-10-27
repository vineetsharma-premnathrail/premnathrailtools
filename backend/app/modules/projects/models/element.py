"""Units of a PM project — one per vehicle (each delivery row of an RRV sales
order line) plus one lot per non-RRV line that has to be made or supplied
(spares, other). Service and freight lines get no unit.

Units are never deleted: a vehicle removed by a sales order amendment is marked
cancelled, so every link other modules hold (order_project_element_id columns)
stays valid. Formerly `sales_order_project_elements` under the Order Project;
the Order Project entity was merged into the PM project (2026-10-27)."""
from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import String, Integer, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Quantity

if TYPE_CHECKING:
    from app.modules.projects.models.project import PmProject

PM_ELEMENT_KINDS = ("vehicle", "lot")
PM_ELEMENT_STATUSES = ("planned", "in_progress", "ready", "dispatched", "delivered", "cancelled")
# Sales order line types that get a lot unit (rrv lines get one unit per vehicle).
PM_ELEMENT_LOT_LINE_TYPES = ("spares", "other")


class PmProjectElement(Base, TimestampMixin):
    __tablename__ = "pm_project_elements"
    __table_args__ = (UniqueConstraint("project_id", "element_no", name="uq_pm_project_element_no"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pm_projects.id", ondelete="CASCADE"), index=True, nullable=False)
    element_no: Mapped[str] = mapped_column(String(40), index=True, nullable=False)  # PEW-80/01 — follows its project number
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    sales_order_line_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_order_lines.id"), index=True, nullable=False)
    # vehicle -> its delivery row; lot -> null (the whole line).
    sales_schedule_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("sales_order_schedules.id"), index=True, nullable=True)
    quantity: Mapped[float] = mapped_column(Quantity, default=1, nullable=False)
    contractual_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned", index=True, nullable=False)

    project: Mapped["PmProject"] = relationship("PmProject", back_populates="elements")
