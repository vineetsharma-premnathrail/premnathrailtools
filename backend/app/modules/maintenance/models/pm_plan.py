from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Boolean, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# Work-order types a PM plan can generate.
MAINTENANCE_PM_WO_TYPES = ("preventive", "calibration", "inspection")
# calendar: every N days/weeks/months/years · meter: every `meter_interval`
# units of the asset's main counter (running hours, km…) · calendar_or_meter:
# whichever comes first (SAP IP42 performance-based / IP11 multiple counter).
MAINTENANCE_PM_TRIGGER_TYPES = ("calendar", "meter", "calendar_or_meter")
MAINTENANCE_PM_METER_TRIGGERS = ("meter", "calendar_or_meter")
MAINTENANCE_PM_FREQUENCY_UNITS = ("day", "week", "month", "year")
# fixed: next due = last due + interval (calendar stays steady);
# floating: next due = last completion + interval.
MAINTENANCE_PM_SCHEDULE_BASES = ("fixed", "floating")


class MaintenancePmPlan(Base, TimestampMixin, SoftDeleteMixin):
    """A preventive-maintenance plan (PM-NNNN) for one asset. The daily
    scheduler (tasks/maintenance_pm_scheduler.py) turns it into a work order
    `lead_days` before `next_due_date`; closing that work order rolls the
    plan forward (service.advance_pm_plan)."""

    __tablename__ = "maintenance_pm_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_assets.id"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    wo_type: Mapped[str] = mapped_column(String(20), default="preventive", nullable=False)

    trigger_type: Mapped[str] = mapped_column(String(20), default="calendar", nullable=False)
    frequency_unit: Mapped[str] = mapped_column(String(10), default="month", nullable=False)
    frequency_value: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    meter_interval: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Meter plans: counter reading at the last completed job, the reading the
    # next job falls due at, and how many units before it to raise the job.
    last_done_meter: Mapped[float | None] = mapped_column(Float, nullable=True)
    next_due_meter: Mapped[float | None] = mapped_column(Float, nullable=True)
    lead_meter: Mapped[float | None] = mapped_column(Float, nullable=True)
    schedule_basis: Mapped[str] = mapped_column(String(10), default="fixed", nullable=False)
    lead_days: Mapped[int] = mapped_column(Integer, default=3, nullable=False)

    next_due_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    last_done_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_work_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("maintenance_work_orders.id", use_alter=True), nullable=True)

    estimated_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_assignee_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    requires_shutdown: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    tasks: Mapped[list["MaintenancePmPlanTask"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="MaintenancePmPlanTask.sequence",
    )
    spares: Mapped[list["MaintenancePmPlanSpare"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="MaintenancePmPlanSpare.id",
    )


class MaintenancePmPlanTask(Base, TimestampMixin):
    """Checklist template line — copied into each generated work order."""

    __tablename__ = "maintenance_pm_plan_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_pm_plans.id", ondelete="CASCADE"), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    expected_value: Mapped[str | None] = mapped_column(String(200), nullable=True)

    plan: Mapped["MaintenancePmPlan"] = relationship(back_populates="tasks")


class MaintenancePmPlanSpare(Base, TimestampMixin):
    """Spares kit line — copied into each generated work order as qty_planned."""

    __tablename__ = "maintenance_pm_plan_spares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_pm_plans.id", ondelete="CASCADE"), index=True, nullable=False)
    store_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=False)
    qty: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    remarks: Mapped[str | None] = mapped_column(String(255), nullable=True)

    plan: Mapped["MaintenancePmPlan"] = relationship(back_populates="spares")


# Data-scope helpers (core/data_scope.py, see maintenance/access.py): the
# plant and department of the asset this record is about — the record has no
# plant column of its own. Deferred SQL expressions, not DB columns (no
# migration); computed only when a scope filter uses them.
def _scope_columns() -> None:
    from sqlalchemy import select
    from sqlalchemy.orm import column_property
    from app.modules.maintenance.models.asset import MaintenanceAsset
    from app.modules.organization.models.department import Department

    MaintenancePmPlan.scope_branch_id = column_property(
        select(MaintenanceAsset.branch_id).where(MaintenanceAsset.id == MaintenancePmPlan.asset_id)
        .correlate_except(MaintenanceAsset).scalar_subquery(),
        deferred=True,
    )
    MaintenancePmPlan.scope_department = column_property(
        select(Department.name).join(MaintenanceAsset, MaintenanceAsset.department_id == Department.id)
        .where(MaintenanceAsset.id == MaintenancePmPlan.asset_id)
        .correlate_except(MaintenanceAsset, Department).scalar_subquery(),
        deferred=True,
    )


_scope_columns()
