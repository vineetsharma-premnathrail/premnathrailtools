"""Order Project — the execution twin of a confirmed Sales Order (SAP PS:
the SO is the commercial contract, the project is what the departments work
against). Not the PM module's "projects" and not the Service "Project"
machine records (erp_projects) — hence the order_project name everywhere.

One project per SO that has at least one RRV line, created automatically at
confirmation (sales/order_projects.py ensure_order_project). Its elements
(WBS) are one per vehicle — each delivery row of an RRV line — plus one lot per
non-RRV line that has to be made / supplied (spares, other). Service and
freight lines get no element. Elements are never deleted: a vehicle removed
by an amendment is marked cancelled, so every link other modules hold stays
valid. Scope ends at delivery."""
from __future__ import annotations

from datetime import date

from sqlalchemy import String, Integer, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Quantity

# 'delivered' is derived (every live element delivered); on_hold / closed are
# set by hand; cancelled follows the Sales Order.
ORDER_PROJECT_STATUSES = ("active", "on_hold", "delivered", "closed", "cancelled")
ORDER_PROJECT_ELEMENT_KINDS = ("vehicle", "lot")
ORDER_PROJECT_ELEMENT_STATUSES = ("planned", "in_progress", "ready", "dispatched", "delivered", "cancelled")
# Sales order line types that get a lot element (rrv lines get one element per vehicle).
ORDER_PROJECT_LOT_LINE_TYPES = ("spares", "other")


class OrderProject(Base, TimestampMixin):
    __tablename__ = "sales_order_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    op_number: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    sales_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id"), unique=True, index=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), index=True, nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    title: Mapped[str] = mapped_column(String(400), nullable=False)
    # Assigned by the Sales Head / planner — null shows "Not assigned".
    project_manager_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True, nullable=False)
    planned_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    elements: Mapped[list["OrderProjectElement"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="OrderProjectElement.id",
    )


class OrderProjectElement(Base, TimestampMixin):
    __tablename__ = "sales_order_project_elements"
    __table_args__ = (UniqueConstraint("order_project_id", "element_no", name="uq_sales_op_element_no"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sales_order_projects.id", ondelete="CASCADE"), index=True, nullable=False)
    element_no: Mapped[str] = mapped_column(String(40), index=True, nullable=False)  # PEW-2026-0001/01 — follows its project number
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    sales_order_line_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_order_lines.id"), index=True, nullable=False)
    # vehicle → its delivery row; lot → null (the whole line).
    sales_schedule_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("sales_order_schedules.id"), index=True, nullable=True)
    quantity: Mapped[float] = mapped_column(Quantity, default=1, nullable=False)
    contractual_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned", index=True, nullable=False)

    project: Mapped[OrderProject] = relationship(back_populates="elements")
