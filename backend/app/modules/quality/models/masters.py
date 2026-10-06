from __future__ import annotations
from sqlalchemy import String, Integer, Text, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Defect categories are fixed (coded) — reports group the Pareto by them.
QUALITY_DEFECT_CATEGORIES = ("dimensional", "surface", "material", "assembly", "functional", "documentation")

# The five dispositions the NCR workflow knows how to execute and approve.
# Disposition *codes* (the master) are user-maintained labels that each map
# to one of these, e.g. "RW-M — Rework by machining" → rework.
QUALITY_DISPOSITION_TYPES = ("use_as_is", "rework", "repair", "return_to_vendor", "scrap")
QUALITY_DISPOSITION_TYPE_LABELS = {
    "use_as_is": "Use as is", "rework": "Rework", "repair": "Repair",
    "return_to_vendor": "Return to vendor", "scrap": "Scrap",
}

# Simple value lists kept in quality_master_values, keyed by list_key.
# ncr_sources values are coded (auto-raised NCRs use them), the rest are
# free lists used by later phases (complaints, audits, third-party calls).
QUALITY_MASTER_LISTS = {
    "ncr_sources": "NCR sources",
    "complaint_categories": "Complaint categories",
    "audit_types": "Audit types",
    "inspection_agencies": "Inspection agencies",
}


class QualityDefectCode(Base, TimestampMixin):
    """Defect code master. Retired with is_active=false, never deleted."""

    __tablename__ = "quality_defect_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)


class QualityDispositionCode(Base, TimestampMixin):
    """Disposition code master — a named disposition mapped to one of the
    coded QUALITY_DISPOSITION_TYPES (which decides approvals and the stock
    effect). Retired with is_active=false, never deleted."""

    __tablename__ = "quality_disposition_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    disposition_type: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)


class QualityMasterValue(Base, TimestampMixin):
    """One value of a simple Quality master list (NCR sources, complaint
    categories, audit types, inspection agencies). `value` never changes once
    created; retire with is_active=false instead of deleting."""

    __tablename__ = "quality_master_values"
    __table_args__ = (UniqueConstraint("list_key", "value", name="uq_quality_master_value"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    list_key: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    value: Mapped[str] = mapped_column(String(60), nullable=False)
    label: Mapped[str] = mapped_column(String(150), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)


class QualitySetting(Base, TimestampMixin):
    """Quality → Settings single values (numbering prefixes, thresholds, KPI
    targets, sampling defaults). One row per key, created on first save;
    defaults live in services/settings.py QUALITY_SETTING_DEFAULTS. Every
    change is audit-logged (app/core/audit_registry.py)."""

    __tablename__ = "quality_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    value: Mapped[object | None] = mapped_column(JSONB, nullable=True)
