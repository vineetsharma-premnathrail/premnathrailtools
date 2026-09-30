from __future__ import annotations
from sqlalchemy import String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# designed → cut → harnessed → installed → terminated → tested. Cable /
# Wiring Design needs at least one cable in the schedule; Wiring / Harness
# Installation is complete once every cable is at least "installed".
ELECTRICAL_CABLE_STATUSES = ("designed", "cut", "harnessed", "installed", "terminated", "tested")
ELECTRICAL_CABLE_INSTALLED = ("installed", "terminated", "tested")


class ElectricalCable(Base, TimestampMixin, SoftDeleteMixin):
    """One run in the job's cable schedule: where it goes from and to, what
    cable it is, which harness it belongs to, and how far along its
    installation is."""

    __tablename__ = "electrical_cables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("electrical_jobs.id"), index=True, nullable=False)
    cable_tag: Mapped[str] = mapped_column(String(50), nullable=False)
    circuit: Mapped[str | None] = mapped_column(String(150), nullable=True)
    from_point: Mapped[str] = mapped_column(String(150), nullable=False)
    to_point: Mapped[str] = mapped_column(String(150), nullable=False)
    cable_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size_sqmm: Mapped[float | None] = mapped_column(Float, nullable=True)
    length_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    voltage_rating: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    harness_ref: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="designed", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
