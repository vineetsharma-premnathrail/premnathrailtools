from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Text, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

HYD_TEST_TYPES = (
    "pressure_test", "proof_test", "leak_test", "flow_test", "functional_test", "performance_test",
    "cleanliness_test", "relief_valve_setting", "cylinder_drift", "endurance_test", "air_quality_test", "other",
)
# planned → in_progress → completed. `result` is set when completing.
HYD_TEST_STATUSES = ("planned", "in_progress", "completed")
HYD_TEST_RESULTS = ("pending", "pass", "fail", "conditional")
HYD_READING_RESULTS = ("pass", "fail", "na")


class HydTest(Base, TimestampMixin, SoftDeleteMixin):
    """A test or inspection on a system or a single component — pressure /
    proof / leak tests, flow and performance runs, oil cleanliness, relief
    valve setting. Individual measurements are HydTestReadings; a reading
    with min/max limits and a measured value is auto-judged pass/fail."""

    __tablename__ = "hyd_tests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    test_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    test_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    system_type: Mapped[str] = mapped_column(String(20), default="hydraulic", nullable=False)
    system_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hyd_systems.id"), index=True, nullable=True)
    component_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hyd_components.id"), index=True, nullable=True)
    component_serial: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    result: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)

    test_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    test_standard: Mapped[str | None] = mapped_column(String(150), nullable=True)
    test_pressure_bar: Mapped[float | None] = mapped_column(Float, nullable=True)
    hold_time_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    test_medium: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ambient_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    fluid_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    tested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    witnessed_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    observations: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    readings: Mapped[list["HydTestReading"]] = relationship(
        "HydTestReading", back_populates="test", cascade="all, delete-orphan", order_by="HydTestReading.sort_order",
    )


class HydTestReading(Base, TimestampMixin):
    __tablename__ = "hyd_test_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    test_id: Mapped[int] = mapped_column(Integer, ForeignKey("hyd_tests.id"), index=True, nullable=False)
    parameter: Mapped[str] = mapped_column(String(200), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Free-text spec ("No visible leakage", "≤ 2 bar drop in 10 min") plus
    # optional numeric limits used to auto-judge the measured value.
    specification: Mapped[str | None] = mapped_column(String(255), nullable=True)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    measured_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    measured_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    result: Mapped[str] = mapped_column(String(10), default="na", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    test: Mapped["HydTest"] = relationship("HydTest", back_populates="readings")
