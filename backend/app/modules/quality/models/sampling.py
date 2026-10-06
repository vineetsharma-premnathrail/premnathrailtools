from __future__ import annotations
from sqlalchemy import String, Integer, Float, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

QUALITY_SAMPLING_SEVERITIES = ("normal", "tightened", "reduced")


class QualitySampleSizeCode(Base):
    """ISO 2859-1 Table I: lot size range → sample size code letter, per
    general inspection level. Seeded (see app/modules/quality/sampling_tables.py),
    read-only in the UI."""

    __tablename__ = "quality_sample_size_codes"
    __table_args__ = (UniqueConstraint("inspection_level", "lot_size_min", name="uq_quality_sample_code_level_min"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inspection_level: Mapped[str] = mapped_column(String(5), nullable=False)
    lot_size_min: Mapped[int] = mapped_column(Integer, nullable=False)
    lot_size_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    code_letter: Mapped[str] = mapped_column(String(2), nullable=False)


class QualityAqlPlan(Base):
    """ISO 2859-1 Table II-A/B/C single sampling plan for one code letter ×
    severity × AQL, with the printed table's arrows already resolved (so
    sample_size may belong to a neighbouring code letter). Seeded."""

    __tablename__ = "quality_aql_plans"
    __table_args__ = (UniqueConstraint("code_letter", "severity", "aql", name="uq_quality_aql_plan"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code_letter: Mapped[str] = mapped_column(String(2), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    aql: Mapped[float] = mapped_column(Float, nullable=False)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False)
    accept_number: Mapped[int] = mapped_column(Integer, nullable=False)
    reject_number: Mapped[int] = mapped_column(Integer, nullable=False)
