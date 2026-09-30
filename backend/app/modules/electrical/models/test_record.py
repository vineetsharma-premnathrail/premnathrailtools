from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# factory = the Electrical Testing stage on the shop floor; commissioning =
# the tests run when the RRV is commissioned on site.
ELECTRICAL_TEST_PHASES = ("factory", "commissioning")

ELECTRICAL_TEST_TYPES: dict[str, str] = {
    "continuity": "Continuity",
    "insulation_resistance": "Insulation Resistance (IR)",
    "polarity": "Polarity",
    "earth_continuity": "Earth Continuity",
    "voltage_drop": "Voltage Drop",
    "battery_charging": "Battery & Charging",
    "lighting": "Lighting",
    "functional": "Functional",
    "load": "Load Test",
    "hipot": "High Voltage (Hi-pot)",
    "other": "Other",
}

ELECTRICAL_TEST_RESULTS = ("pass", "fail")


class ElectricalTest(Base, TimestampMixin, SoftDeleteMixin):
    """One recorded electrical test. A failed test stays on record; fixing
    it means recording a retest (retest_of_id → the failed one). A phase's
    testing is clear only when every failed test has a passing retest."""

    __tablename__ = "electrical_tests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("electrical_jobs.id"), index=True, nullable=False)
    test_number: Mapped[str] = mapped_column(String(30), nullable=False)
    phase: Mapped[str] = mapped_column(String(20), default="factory", nullable=False)
    test_type: Mapped[str] = mapped_column(String(30), nullable=False)
    circuit: Mapped[str | None] = mapped_column(String(150), nullable=True)
    panel_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("electrical_panels.id"), nullable=True)
    cable_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("electrical_cables.id"), nullable=True)
    instrument: Mapped[str | None] = mapped_column(String(150), nullable=True)
    expected_value: Mapped[str | None] = mapped_column(String(100), nullable=True)
    measured_value: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    result: Mapped[str] = mapped_column(String(10), nullable=False)
    test_date: Mapped[date] = mapped_column(Date, nullable=False)
    tested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    retest_of_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("electrical_tests.id"), index=True, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
