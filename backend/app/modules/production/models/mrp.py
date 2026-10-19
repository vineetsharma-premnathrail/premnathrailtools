"""Material Requirements Planning (SAP PP-MRP: MD01N run, MD11-MD13 planned
orders, MD05/MD06 MRP list and exception messages). The engine is
production/mrp.py; the routes are production/routes/mrp.py.

A run nets, per plant and item (lowest BOM level first), the independent
demand (Sales Order schedule lines, RRV builds with no work order yet), the
dependent demand (open work-order material lines, the components of planned
orders) and other reservations against unrestricted stock and fixed receipts
(open PR / PO lines, open work-order output, firmed planned orders). Every
shortfall becomes a planned order: procurement "make" (the item has an active
Production BOM) converts into a work order, "buy" into a purchase-requisition
line carrying store_item_id. Each run deletes (status "deleted") the previous
run's open, not firmed planned orders for the same plant scope; firmed and
converted ones stay.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

MRP_RUN_STATUSES = ("running", "completed", "failed")
# open = a planning proposal; converted = became a work order / PR line;
# deleted = removed by a re-run or a planner. Deleted rows are kept (not
# hard-deleted) so a PLO number is never handed out twice.
PLANNED_ORDER_STATUSES = ("open", "converted", "deleted")
PLANNED_ORDER_PROCUREMENT = ("make", "buy")
# Where a planned order came from: "mrp" (a run) or "manual" (MD11).
PLANNED_ORDER_SOURCES = ("mrp", "manual")
PLANNED_ORDER_CONVERTED_TYPES = ("work_order", "purchase_requisition")

# Exception messages (SAP numbers in brackets) — see production/mrp.py.
MRP_EXCEPTION_LABELS: dict[str, str] = {
    "reschedule_in": "Bring receipt forward (10)",
    "reschedule_out": "Postpone receipt (15)",
    "cancel": "Receipt not needed — cancel (20)",
    "start_in_past": "Start / order date in the past (06)",
    "finish_in_past": "Receipt overdue — finish date in the past (07)",
    "below_safety_stock": "Stock below safety stock (96)",
    "shortage": "Uncovered requirement",
    "no_product_item": "Demand without a Store item",
    "no_lead_time": "No lead time in the Item Master",
    "item_inactive": "Item not active — not planned",
    "bom_cycle": "BOM structure loops back on itself",
    "beyond_horizon": "Requirements beyond the planning horizon",
    "not_mrp_planned": "Not planned by MRP at this plant",
    "make_without_bom": "Make at this plant but no active BOM",
}


class ProductionMrpRun(Base, TimestampMixin):
    """One MRP run (MD01N) for a plant — the run log."""

    __tablename__ = "production_mrp_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    # The plant (branch) planned; NULL = company-wide (every plant together).
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    # Plant runs only: also plan documents and stock that carry no plant.
    include_unassigned: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="running", nullable=False)
    # The coded MRP parameters in force for this run (horizon, tolerances …).
    parameters: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    run_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    items_planned: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    planned_orders_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    make_orders: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    buy_orders: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    planned_orders_deleted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exceptions_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # MD05 MRP list: one summary row per item planned (stock, demand,
    # receipts, new planned orders, exceptions, ending available).
    item_results: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Run log: [{level, message}] in the order it happened.
    log: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProductionPlannedOrder(Base, TimestampMixin):
    """A planned order (MD11-MD13): quantity of an item to make or buy,
    finishing (available) on finish_date, starting / ordered on start_date.
    The demand it covers is pegged through the demand_* / sales_* / rrv_*
    columns (the top-level requirement, carried down to sub-assembly and
    component planned orders)."""

    __tablename__ = "production_planned_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    run_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_mrp_runs.id"), index=True, nullable=True)
    source: Mapped[str] = mapped_column(String(10), default="mrp", nullable=False)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    procurement: Mapped[str] = mapped_column(String(10), nullable=False)
    bom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_boms.id"), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    finish_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    # Firmed: MRP won't delete or change it on the next run (set by hand, or
    # automatically when quantity / dates are changed by a planner).
    firmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True, nullable=False)
    # Pegging — the requirement this order covers.
    demand_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    demand_ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    demand_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    parent_planned_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_planned_orders.id"), nullable=True)
    sales_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_orders.id"), index=True, nullable=True)
    sales_schedule_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_order_schedules.id"), nullable=True)
    rrv_build_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_rrv_builds.id"), index=True, nullable=True)
    # Order Project element of the pegged demand (vehicle / lot) — Purchase
    # reads it from buy planned orders and the PRs they become.
    order_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_order_projects.id", ondelete="SET NULL"), index=True, nullable=True)
    order_project_element_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_order_project_elements.id", ondelete="SET NULL"), index=True, nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=True)
    work_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_work_orders.id"), nullable=True)
    # Conversion (to a work order or a PR) — the document it became.
    converted_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    converted_ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    converted_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    converted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    changed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProductionMrpException(Base, TimestampMixin):
    """An exception message of a run (MD06 collective list)."""

    __tablename__ = "production_mrp_exceptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_mrp_runs.id"), index=True, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=True)
    code: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    element_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    element_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    element_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    suggested_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
