"""Measuring points / counters (SAP IK01-IK03) and measuring documents
(IK11 / IK17) for plant assets.

The asset's own meter (MaintenanceAsset.meter_unit / current_meter_reading)
stays the MAIN counter — the one performance-based PM plans run on. Extra
points (a second counter, or a condition value such as temperature,
vibration or pressure with limits) live in maintenance_measuring_points.
Every reading — main counter or point — is one row in
maintenance_measurement_docs, so readings are never overwritten."""
from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# manual = typed on the asset page · scan = from the QR scan page ·
# wo_completion = captured when a work order is completed.
MAINTENANCE_READING_SOURCES = ("manual", "scan", "wo_completion")
# Where a reading fell against its point's limits.
MAINTENANCE_READING_BREACHES = ("low", "high")


class MaintenanceMeasuringPoint(Base, TimestampMixin):
    """One extra measuring point on an asset. `is_counter` points (running
    hours of a second engine, km of a trailer axle…) only go up; condition
    points (temperature, pressure, vibration) may move both ways and are
    checked against lower / upper limits."""

    __tablename__ = "maintenance_measuring_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_assets.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    is_counter: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    lower_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    upper_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_reading: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class MaintenanceMeasurementDoc(Base, TimestampMixin):
    """One reading (measuring document). `measuring_point_id` NULL = the
    asset's main meter. `previous_reading` / `difference` are snapshots at
    entry time (the counter delta that drives performance-based PM)."""

    __tablename__ = "maintenance_measurement_docs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_assets.id", ondelete="CASCADE"), index=True, nullable=False)
    measuring_point_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("maintenance_measuring_points.id", ondelete="CASCADE"), index=True, nullable=True)
    reading: Mapped[float] = mapped_column(Float, nullable=False)
    previous_reading: Mapped[float | None] = mapped_column(Float, nullable=True)
    difference: Mapped[float | None] = mapped_column(Float, nullable=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    read_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    work_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("maintenance_work_orders.id"), nullable=True)
    # low / high when the reading fell outside the point's limits; the
    # abnormality request it raised.
    limit_breach: Mapped[str | None] = mapped_column(String(10), nullable=True)
    request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("maintenance_requests.id"), nullable=True)
    # A counter entered lower than the last reading (meter replaced / reset)
    # — admin only, with the reason.
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
