from datetime import date
from sqlalchemy import String, Integer, Float, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# Every record in this module is tagged hydraulic or pneumatic; components
# and spares can also be "both" (fittings, gauges, seals used on either).
HYD_SYSTEM_TYPES = ("hydraulic", "pneumatic")
HYD_MEDIA_TYPES = ("hydraulic", "pneumatic", "both")

HYD_SYSTEM_STATUSES = (
    "design", "under_build", "testing", "commissioned", "in_service", "under_maintenance", "decommissioned",
)


class HydSystem(Base, TimestampMixin, SoftDeleteMixin):
    """One hydraulic or pneumatic system — a power pack, a brake circuit, a
    tamping unit's actuation, a plant air network. Circuits, BOMs, tests,
    maintenance plans and service records all hang off a system.

    `flow_rate` is L/min for hydraulic systems and Nl/min (free air) for
    pneumatic ones; `reservoir_capacity_l` is the oil tank or the air
    receiver. The UI labels both by system type."""

    __tablename__ = "hyd_systems"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    system_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    system_type: Mapped[str] = mapped_column(String(20), default="hydraulic", index=True, nullable=False)
    application: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="design", nullable=False)

    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), index=True, nullable=True)
    # Branch = "Plant" in the UI.
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    equipment_ref: Mapped[str | None] = mapped_column(String(150), nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)

    working_pressure_bar: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_pressure_bar: Mapped[float | None] = mapped_column(Float, nullable=True)
    flow_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    reservoir_capacity_l: Mapped[float | None] = mapped_column(Float, nullable=True)
    prime_mover_kw: Mapped[float | None] = mapped_column(Float, nullable=True)
    fluid_medium: Mapped[str | None] = mapped_column(String(150), nullable=True)
    filtration_micron: Mapped[float | None] = mapped_column(Float, nullable=True)
    # ISO 4406 target code for hydraulic oil (e.g. "18/16/13"), or the
    # ISO 8573-1 air quality class for pneumatic (e.g. "1.4.1").
    cleanliness_target: Mapped[str | None] = mapped_column(String(30), nullable=True)
    operating_temp_min_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    operating_temp_max_c: Mapped[float | None] = mapped_column(Float, nullable=True)

    commissioned_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    running_hours: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    owner_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
