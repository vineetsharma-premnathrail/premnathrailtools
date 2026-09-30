from __future__ import annotations
from datetime import date
from typing import Any
from sqlalchemy import String, Integer, Date, Text, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

RND_EXPERIMENT_TYPES = ("research", "lab_test", "field_trial", "simulation", "validation")
RND_EXPERIMENT_STATUSES = ("planned", "in_progress", "completed", "cancelled")
RND_EXPERIMENT_RESULTS = ("pass", "fail", "inconclusive")


class RndExperiment(Base, TimestampMixin, SoftDeleteMixin):
    """One experiment / test run under an R&D project (SAP QM test-data
    equivalent). `parameters` holds the measured readings as a list of
    {parameter, specification, measured, unit, result} rows."""

    __tablename__ = "rnd_experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_projects.id"), index=True, nullable=False)
    prototype_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_prototypes.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    experiment_type: Mapped[str] = mapped_column(String(20), default="lab_test", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    result: Mapped[str | None] = mapped_column(String(20), nullable=True)
    objective: Mapped[str | None] = mapped_column(Text, nullable=True)
    method: Mapped[str | None] = mapped_column(Text, nullable=True)
    experiment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    conducted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    parameters: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    observations: Mapped[str | None] = mapped_column(Text, nullable=True)
    conclusion: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
