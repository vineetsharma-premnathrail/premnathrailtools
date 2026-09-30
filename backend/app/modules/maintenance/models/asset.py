from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

MAINTENANCE_ASSET_CATEGORIES = (
    "production_machine", "material_handling", "utility", "tooling_fixture",
    "instrument", "facility", "vehicle", "other",
)
MAINTENANCE_ASSET_CRITICALITIES = ("A", "B", "C")
# breakdown / under_maintenance are system-managed (service.sync_asset_status);
# standby / decommissioned are set by hand.
MAINTENANCE_ASSET_STATUSES = ("operational", "breakdown", "under_maintenance", "standby", "decommissioned")
MAINTENANCE_ASSET_MANUAL_STATUSES = ("operational", "standby", "decommissioned")


class MaintenanceAsset(Base, TimestampMixin, SoftDeleteMixin):
    """A piece of plant equipment (machine, crane, compressor, DG set,
    facility…) — the register every maintenance request and work order hangs
    off. Employee-issued assets stay in HR; customer machines stay in ERP."""

    __tablename__ = "maintenance_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # User-entered (plants already have machine numbers); EQ-NNNN if blank.
    asset_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(30), default="production_machine", nullable=False)
    parent_asset_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("maintenance_assets.id"), nullable=True)

    branch_id: Mapped[int] = mapped_column(Integer, ForeignKey("branches.id"), index=True, nullable=False)
    department_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("departments.id"), nullable=True)
    location_text: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Optional link to a Production workstation — while the asset is down the
    # workstation is set to under_maintenance so the shop floor can't use it.
    workstation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_workstations.id"), unique=True, nullable=True)

    make: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    year_of_manufacture: Mapped[int | None] = mapped_column(Integer, nullable=True)

    supplier_vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    purchase_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    warranty_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    amc_vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    amc_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)

    criticality: Mapped[str] = mapped_column(String(1), default="B", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="operational", nullable=False)

    meter_unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    current_meter_reading: Mapped[float | None] = mapped_column(Float, nullable=True)
    meter_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    commissioned_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    decommissioned_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
