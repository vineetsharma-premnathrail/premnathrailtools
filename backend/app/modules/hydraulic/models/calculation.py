from sqlalchemy import String, Integer, Text, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin


class HydCalculation(Base, TimestampMixin, SoftDeleteMixin):
    """A saved engineering calculation (cylinder force, pump power, pipe
    sizing, accumulator sizing, air consumption…). `results` is always
    recomputed server-side from `inputs` when saved — see
    app/modules/hydraulic/calculations.py — never taken from the client.

    Not to be confused with app.modules.rnd.models.tool_calculations
    .HydraulicCalculation, the R&D locomotive hydrostatic-drive tool's
    history table."""

    __tablename__ = "hyd_calculations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    calc_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    calc_type: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    system_type: Mapped[str] = mapped_column(String(20), nullable=False)
    system_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hyd_systems.id"), index=True, nullable=True)
    inputs: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    results: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
