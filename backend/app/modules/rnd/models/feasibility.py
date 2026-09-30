from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

RND_FEASIBILITY_RATINGS = ("feasible", "conditional", "not_feasible")
RND_FEASIBILITY_RECOMMENDATIONS = ("go", "conditional_go", "no_go")


class RndFeasibilityStudy(Base, TimestampMixin):
    """The single feasibility study for an R&D project — the four checks
    from the SAP mapping (production costing, material sourcing, process
    viability, quality achievability) plus a go/no-go recommendation that
    gates the move to Handover."""

    __tablename__ = "rnd_feasibility_studies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_projects.id"), unique=True, index=True, nullable=False)

    material_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    labour_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    overhead_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_selling_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    costing_rating: Mapped[str | None] = mapped_column(String(20), nullable=True)
    costing_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    sourcing_rating: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sourcing_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    process_rating: Mapped[str | None] = mapped_column(String(20), nullable=True)
    process_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality_rating: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quality_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    recommendation: Mapped[str | None] = mapped_column(String(20), nullable=True)
    decision_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
