from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

PM_PROJECT_STATUSES = ("planning", "active", "on_hold", "completed", "cancelled")
PM_PROJECT_PRIORITIES = ("low", "medium", "high", "critical")


class PmProject(Base, TimestampMixin):
    """Project Management module's project record. Not to be confused with
    `app.modules.erp.models.project.Project` (table `erp_projects`) — that is
    an unrelated machine/asset registry used by the Service module. This
    model's table is `pm_projects`, entirely separate."""

    __tablename__ = "pm_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope_statement: Mapped[str | None] = mapped_column(Text, nullable=True)
    objectives: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    project_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planning", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="medium", nullable=False)
    project_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    sponsor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Closure fields — inline since it's a 1:1 relationship per project, not
    # a separate table (mirrors how QualityInspection keeps its own status
    # rather than a child closure record).
    closure_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    final_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    lessons_learned: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_signoff: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    closure_report: Mapped[str | None] = mapped_column(Text, nullable=True)
