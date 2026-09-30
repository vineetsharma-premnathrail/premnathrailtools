from __future__ import annotations
from datetime import time
from decimal import Decimal
from sqlalchemy import String, Integer, Boolean, Text, Time, Numeric, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class HrGrade(Base, TimestampMixin):
    """Employee grade/band (e.g. M1, E2). `level` orders grades for display
    and promotion checks — higher is more senior."""

    __tablename__ = "hr_grades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    level: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)


class HrDesignation(Base, TimestampMixin):
    """Job title master. Its `name` is mirrored onto User.designation by
    services/employee_sync.apply_org_fields so older modules that read the
    free-text column keep working."""

    __tablename__ = "hr_designations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True, nullable=True)
    grade_id: Mapped[int | None] = mapped_column(ForeignKey("hr_grades.id"), index=True, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)


class HrShift(Base, TimestampMixin):
    """Work shift. `branch_id` NULL means the shift applies at every plant."""

    __tablename__ = "hr_shifts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    grace_minutes: Mapped[int] = mapped_column(Integer, default=10, server_default="10", nullable=False)
    working_hours: Mapped[Decimal | None] = mapped_column(Numeric(4, 2), nullable=True)
    is_night: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
