"""Time-sliced organizational assignment (SAP PA30 infotype 0001).

One row per validity period of an employee's org assignment: department,
designation, grade, plant, cost center, reporting manager, employment type.
`valid_to` NULL = the open (current) slice. A change from an effective date
closes the previous slice on the day before (valid_to = new valid_from − 1)
and opens a new one, so "who was where on date X" is answered by
valid_from <= X AND (valid_to IS NULL OR valid_to >= X).

The profile (hr_employee_profiles) and the User row keep holding the
CURRENT values — older modules read them; this table is the history.
"""
from __future__ import annotations

from datetime import date

from datetime import datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

ASSIGNMENT_SOURCES = ("backfill", "profile_edit", "joining", "transfer", "promotion", "manual")

# Fields carried on a slice (also the order shown in the history table).
ASSIGNMENT_FIELDS = (
    "department_id", "designation_id", "grade_id", "branch_id", "cost_center_id", "reporting_manager_id", "employment_type",
)


class HrEmployeeAssignment(Base, TimestampMixin):
    __tablename__ = "hr_employee_assignments"
    __table_args__ = (UniqueConstraint("user_id", "valid_from", name="uq_hr_employee_assignment_user_from"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    valid_from: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)

    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    designation_id: Mapped[int | None] = mapped_column(ForeignKey("hr_designations.id"), nullable=True)
    grade_id: Mapped[int | None] = mapped_column(ForeignKey("hr_grades.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(ForeignKey("cost_centers.id"), nullable=True)
    reporting_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    employment_type: Mapped[str | None] = mapped_column(String(20), nullable=True)

    source: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual", nullable=False)
    source_event_id: Mapped[int | None] = mapped_column(ForeignKey("hr_lifecycle_events.id"), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When the slice's values were written onto the profile / User. NULL =
    # a future-dated change still waiting for its date (daily job applies it).
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
