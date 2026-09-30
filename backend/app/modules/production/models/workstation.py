from sqlalchemy import String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

PRODUCTION_WORKSTATION_TYPES = ("machine", "work_center", "assembly_bay", "test_bench", "paint_booth", "other")
PRODUCTION_WORKSTATION_STATUSES = ("active", "under_maintenance", "inactive")


class ProductionWorkstation(Base, TimestampMixin, SoftDeleteMixin):
    """A machine or work center on the shop floor that routing operations run
    on. `hourly_rate` is what an hour of work here costs — it's what turns a
    work order's logged hours into its labour/machine cost."""

    __tablename__ = "production_workstations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    workstation_type: Mapped[str] = mapped_column(String(30), default="machine", nullable=False)
    # Branch = "Plant" in the UI.
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    department_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("departments.id"), nullable=True)
    capacity_hours_per_day: Mapped[float] = mapped_column(Float, default=8.0, nullable=False)
    hourly_rate: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
