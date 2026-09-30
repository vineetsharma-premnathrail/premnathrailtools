from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Text, Date, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

HYD_MAINTENANCE_TYPES = (
    "preventive", "oil_change", "oil_sampling", "filter_change", "seal_inspection", "hose_inspection",
    "accumulator_precharge", "calibration", "lubrication", "condensate_drain", "general_inspection",
)
HYD_SERVICE_TYPES = (
    "preventive", "corrective", "breakdown", "oil_change", "filter_change", "overhaul",
    "commissioning", "inspection", "modification",
)
# open → in_progress → completed; open/in_progress → cancelled.
HYD_SERVICE_STATUSES = ("open", "in_progress", "completed", "cancelled")
# Service types that mean the system is down while the job is open.
HYD_DOWNTIME_SERVICE_TYPES = ("corrective", "breakdown", "overhaul")
HYD_SERVICE_REFERENCE_TYPE = "hyd_service"


class HydMaintenancePlan(Base, TimestampMixin, SoftDeleteMixin):
    """A recurring maintenance task on a system — every N days and/or every
    N running hours, whichever comes first. Completing a service record
    raised against the plan moves `last_done_*` and `next_due_date`
    forward, so the plan never needs to be edited to stay current."""

    __tablename__ = "hyd_maintenance_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    system_id: Mapped[int] = mapped_column(Integer, ForeignKey("hyd_systems.id"), index=True, nullable=False)
    maintenance_type: Mapped[str] = mapped_column(String(30), default="preventive", nullable=False)
    frequency_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    frequency_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_done_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_done_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    next_due_date: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)
    assigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # One task per line — copied onto the service record as its checklist.
    checklist: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class HydServiceRecord(Base, TimestampMixin, SoftDeleteMixin):
    """One maintenance / service job actually carried out on a system —
    planned (from a HydMaintenancePlan) or not (breakdown, corrective,
    modification). Spares used are HydServiceParts; on completion they can
    be issued from Store stock in the same step."""

    __tablename__ = "hyd_service_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    system_id: Mapped[int] = mapped_column(Integer, ForeignKey("hyd_systems.id"), index=True, nullable=False)
    plan_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hyd_maintenance_plans.id"), index=True, nullable=True)
    service_type: Mapped[str] = mapped_column(String(30), default="preventive", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)
    service_date: Mapped[date] = mapped_column(Date, nullable=False)
    completed_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    reported_problem: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    work_done: Mapped[str | None] = mapped_column(Text, nullable=True)
    checklist: Mapped[str | None] = mapped_column(Text, nullable=True)
    performed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    external_agency: Mapped[str | None] = mapped_column(String(200), nullable=True)

    running_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    downtime_hours: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    fluid_added_l: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    oil_condition: Mapped[str | None] = mapped_column(String(100), nullable=True)
    labour_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    other_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    next_service_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    parts: Mapped[list["HydServicePart"]] = relationship(
        "HydServicePart", back_populates="record", cascade="all, delete-orphan", order_by="HydServicePart.id",
    )


class HydServicePart(Base, TimestampMixin):
    """A spare used on a service job. `issued_location_id` is set once the
    quantity has been posted out of Store stock (only possible when the
    spare is linked to a Store item)."""

    __tablename__ = "hyd_service_parts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("hyd_service_records.id"), index=True, nullable=False)
    spare_part_id: Mapped[int] = mapped_column(Integer, ForeignKey("hyd_spare_parts.id"), index=True, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    issued_location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)

    record: Mapped["HydServiceRecord"] = relationship("HydServiceRecord", back_populates="parts")
