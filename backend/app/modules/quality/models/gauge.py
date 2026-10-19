"""Test equipment / gauge management (SAP QM-IM: equipment as test
equipment + calibration plan, ISO 9001 cl. 7.1.5).

Every instrument used to record inspection results is a row here with its
calibration interval and next due date. Results recording refuses a gauge
that is overdue, out of calibration or scrapped (quality/services/gauges.py),
and a daily job reminds Quality of gauges falling due."""
from __future__ import annotations

from datetime import date

from sqlalchemy import Date, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# active = in calibration and usable; out_of_calibration = failed a
# calibration or was found damaged (blocked until re-calibrated);
# scrapped = withdrawn for good.
QUALITY_GAUGE_STATUSES = ("active", "out_of_calibration", "scrapped")
QUALITY_CALIBRATION_RESULTS = ("pass", "fail", "adjusted")


class QualityGauge(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "quality_gauges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Free text matched against the characteristic's gauge_type
    # (e.g. "Vernier caliper", "Torque wrench").
    gauge_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    make: Mapped[str | None] = mapped_column(String(120), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    measuring_range: Mapped[str | None] = mapped_column(String(120), nullable=True)
    least_count: Mapped[str | None] = mapped_column(String(60), nullable=True)
    location: Mapped[str | None] = mapped_column(String(150), nullable=True)
    custodian_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="active", index=True, nullable=False)
    calibration_interval_days: Mapped[int] = mapped_column(Integer, default=365, nullable=False)
    last_calibrated_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_due_on: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)
    certificate_ref: Mapped[str | None] = mapped_column(String(150), nullable=True)
    calibration_agency: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Optional link to the Maintenance asset register (calibration WO).
    maintenance_asset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("maintenance_assets.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    calibrations: Mapped[list["QualityGaugeCalibration"]] = relationship(
        "QualityGaugeCalibration", back_populates="gauge", cascade="all, delete-orphan",
        order_by="QualityGaugeCalibration.calibrated_on.desc()",
    )


class QualityGaugeCalibration(Base, TimestampMixin):
    """One calibration done on a gauge (in-house or by an NABL lab)."""

    __tablename__ = "quality_gauge_calibrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gauge_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_gauges.id"), index=True, nullable=False)
    calibrated_on: Mapped[date] = mapped_column(Date, nullable=False)
    result: Mapped[str] = mapped_column(String(20), nullable=False)
    next_due_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    agency: Mapped[str | None] = mapped_column(String(200), nullable=True)
    certificate_ref: Mapped[str | None] = mapped_column(String(150), nullable=True)
    error_found: Mapped[float | None] = mapped_column(Float, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    gauge: Mapped["QualityGauge"] = relationship("QualityGauge", back_populates="calibrations")
