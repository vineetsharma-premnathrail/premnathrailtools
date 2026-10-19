"""CO cost-centre planning (SAP KP06): plan by cost centre x ledger x month,
in plan versions (original / revised) per financial year. Planning posts
nothing — it is compared against actual journal lines (plan vs actual)."""
from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

CO_PLAN_VERSION_TYPES = ("original", "revised")
CO_PLAN_STATUSES = ("draft", "locked")


class CoPlanVersion(Base, TimestampMixin):
    __tablename__ = "co_plan_versions"
    __table_args__ = (UniqueConstraint("financial_year", "code", name="uq_co_plan_version_fy_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    financial_year: Mapped[str] = mapped_column(String(10), index=True, nullable=False)  # "2026-27"
    version_type: Mapped[str] = mapped_column(String(20), nullable=False, default="original")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    # The version plan-vs-actual uses by default for its FY (one per FY).
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    copied_from_version_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("co_plan_versions.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    locked_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lines: Mapped[list["CoPlanLine"]] = relationship(back_populates="version", cascade="all, delete-orphan")


class CoPlanLine(Base, TimestampMixin):
    __tablename__ = "co_plan_lines"
    __table_args__ = (
        UniqueConstraint("version_id", "cost_center_id", "gl_account_id", "accounting_period", name="uq_co_plan_line_cell"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(Integer, ForeignKey("co_plan_versions.id", ondelete="CASCADE"), index=True, nullable=False)
    cost_center_id: Mapped[int] = mapped_column(Integer, ForeignKey("cost_centers.id"), index=True, nullable=False)
    gl_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=False)
    accounting_period: Mapped[str] = mapped_column(String(7), nullable=False)  # "YYYY-MM"
    amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)

    version: Mapped[CoPlanVersion] = relationship(back_populates="lines")
