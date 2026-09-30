from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Boolean, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

EMPLOYMENT_TYPES = ("permanent", "probation", "contract", "trainee", "intern", "consultant")
EMPLOYMENT_STATUSES = ("onboarding", "probation", "active", "notice", "exited")

# Columns that may only be returned to hr-app users and to the employee themself.
PII_FIELDS = (
    "gender", "date_of_birth", "blood_group", "marital_status", "personal_email", "personal_phone",
    "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation",
    "current_address", "permanent_address", "pan_number", "aadhaar_last4", "uan_number", "esic_number",
)


class HrEmployeeProfile(Base, TimestampMixin):
    """HR-owned employee record, one per portal user.

    Manager and date of joining are NOT here — User.reporting_manager_id and
    User.date_of_joining stay the single source of truth. Department,
    designation and plant are mirrored back onto the User row by
    services/employee_sync.apply_org_fields.

    PII columns (see PII_FIELDS) may only be returned to hr-app users and to
    the employee themself. Full Aadhaar is never stored — only the last 4."""

    __tablename__ = "hr_employee_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True, nullable=False)
    employee_code: Mapped[str | None] = mapped_column(String(30), unique=True, index=True, nullable=True)

    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True, nullable=True)
    designation_id: Mapped[int | None] = mapped_column(ForeignKey("hr_designations.id"), index=True, nullable=True)
    grade_id: Mapped[int | None] = mapped_column(ForeignKey("hr_grades.id"), index=True, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("hr_shifts.id"), index=True, nullable=True)

    employment_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    employment_status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", index=True, nullable=False)
    probation_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    confirmation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_of_exit: Mapped[date | None] = mapped_column(Date, nullable=True)
    exit_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- PII ---
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    blood_group: Mapped[str | None] = mapped_column(String(10), nullable=True)
    marital_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    personal_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    personal_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    emergency_contact_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    emergency_contact_relation: Mapped[str | None] = mapped_column(String(50), nullable=True)
    current_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    permanent_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    pan_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    aadhaar_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    uan_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    esic_number: Mapped[str | None] = mapped_column(String(20), nullable=True)

    work_location: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # When true, Azure login/sync must NOT overwrite department, designation
    # or reporting_manager_id on the User row — HR owns them.
    org_fields_locked: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
