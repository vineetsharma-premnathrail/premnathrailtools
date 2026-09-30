from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Boolean, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

MAINTENANCE_WO_TYPES = ("breakdown", "preventive", "corrective", "calibration", "improvement", "inspection")
# draft → assigned → in_progress ⇄ on_hold → completed → closed;
# cancelled from draft / assigned / on_hold. Transitions only via the action
# endpoints in routes/work_orders.py — never a generic status PATCH.
MAINTENANCE_WO_STATUSES = ("draft", "assigned", "in_progress", "on_hold", "completed", "closed", "cancelled")
MAINTENANCE_WO_OPEN_STATUSES = ("draft", "assigned", "in_progress", "on_hold")
MAINTENANCE_FAILURE_CATEGORIES = (
    "mechanical", "electrical", "hydraulic", "pneumatic", "lubrication", "electronic_control",
    "wear_and_tear", "operator_error", "external", "other",
)
# Work orders of these types need root cause / action taken to be completed.
MAINTENANCE_WO_TYPES_NEEDING_RCA = ("breakdown", "corrective")
MAINTENANCE_TASK_RESULTS = ("ok", "not_ok", "na")


class MaintenanceWorkOrder(Base, TimestampMixin):
    """A maintenance job (MWO-). `labour_cost` / `spares_cost` / `total_cost`
    are recomputed by service.recompute_costs and never hand-edited."""

    __tablename__ = "maintenance_work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wo_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_assets.id"), index=True, nullable=False)
    request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("maintenance_requests.id"), nullable=True)
    wo_type: Mapped[str] = mapped_column(String(20), default="breakdown", nullable=False)
    priority: Mapped[str] = mapped_column(String(10), default="normal", nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)

    # Whether the machine is out of service for this job — drives the asset /
    # workstation status sync and the downtime clock.
    machine_down: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    assigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    planned_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    downtime_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    downtime_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    downtime_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    failure_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_taken: Mapped[str | None] = mapped_column(Text, nullable=True)
    hold_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    external_vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    external_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    labour_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    spares_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # Requester sign-off: completed jobs raised from a request need the
    # requester to confirm the machine is OK before the planner can close.
    requester_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requester_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    verified_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    tasks: Mapped[list["MaintenanceWorkOrderTask"]] = relationship(
        back_populates="work_order", cascade="all, delete-orphan", order_by="MaintenanceWorkOrderTask.sequence",
    )
    spares: Mapped[list["MaintenanceWorkOrderSpare"]] = relationship(
        back_populates="work_order", cascade="all, delete-orphan", order_by="MaintenanceWorkOrderSpare.id",
    )
    labour_logs: Mapped[list["MaintenanceLabourLog"]] = relationship(
        back_populates="work_order", cascade="all, delete-orphan", order_by="MaintenanceLabourLog.id",
    )


class MaintenanceWorkOrderTask(Base, TimestampMixin):
    """One checklist line on a work order."""

    __tablename__ = "maintenance_work_order_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    expected_value: Mapped[str | None] = mapped_column(String(100), nullable=True)
    result: Mapped[str | None] = mapped_column(String(10), nullable=True)
    measured_value: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    done_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    work_order: Mapped[MaintenanceWorkOrder] = relationship(back_populates="tasks")


class MaintenanceWorkOrderSpare(Base, TimestampMixin):
    """A spare part used on a job. Stock moves only through the Store ledger
    (reference_type="maintenance_work_order"); this row just tracks planned /
    issued / returned quantities and the cost snapshot at issue time."""

    __tablename__ = "maintenance_work_order_spares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    store_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=False)
    location_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=False)
    qty_planned: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    qty_issued: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    qty_returned: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    work_order: Mapped[MaintenanceWorkOrder] = relationship(back_populates="spares")


class MaintenanceLabourLog(Base, TimestampMixin):
    """Hours a technician spent on a job. `hourly_rate` is optional — payroll
    lives in ADP, so the portal has no salary data; leave it 0 to track hours
    without costing them."""

    __tablename__ = "maintenance_labour_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    technician_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hours: Mapped[float] = mapped_column(Float, nullable=False)
    hourly_rate: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    work_order: Mapped[MaintenanceWorkOrder] = relationship(back_populates="labour_logs")
