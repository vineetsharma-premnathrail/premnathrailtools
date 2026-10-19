from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Boolean, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Terms of employment. Probation is NOT a type or a status — it is its own
# field (PROBATION_STATUSES), so "permanent, on probation" reads as it is.
# intern / consultant are kept for older records; the form offers the rest.
EMPLOYMENT_TYPES = ("permanent", "fixed_term", "contract", "trainee", "intern", "consultant")
EMPLOYMENT_STATUSES = ("onboarding", "active", "notice", "exited")
PROBATION_STATUSES = {"not_applicable": "Not applicable", "on_probation": "On probation", "confirmed": "Confirmed"}
CLEARANCE_STATUSES = {
    "safety_induction_status": {"pending": "Pending", "completed": "Completed", "not_required": "Not required"},
    "medical_clearance_status": {"pending": "Pending", "cleared": "Cleared", "not_required": "Not required"},
}
VERIFICATION_STATUSES = {"pending": "Pending", "verified": "Verified", "rejected": "Rejected"}
# Workforce type (SAP employee group): who the person is to the company.
# Separate from employment_type, which is the terms of OUR employment —
# 'contract' labour here is the contractor's worker, not a fixed-term employee.
WORKER_TYPES = {
    "office": "Office staff", "factory": "Factory / workshop", "housekeeping": "Housekeeping / cleaning",
    "contract": "Contract labour", "other": "Other",
}
# How a person's attendance is captured. Stored now; attendance screens will
# use it later (services/workforce_rules.py says so on the field).
ATTENDANCE_POLICIES = {
    "biometric": "Biometric punch", "supervisor": "Marked by supervisor", "self": "Self-service (portal)",
    "exempt": "Exempt from attendance",
}

# Columns that may only be returned to hr-app users and to the employee themself.
PII_FIELDS = (
    "gender", "date_of_birth", "blood_group", "marital_status", "personal_email", "personal_phone",
    "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation",
    "current_address", "permanent_address", "pan_number", "aadhaar_last4", "uan_number", "esic_number",
)


class HrEmployeeProfile(Base, TimestampMixin):
    """HR-owned workforce record: one per portal user, plus people with no
    portal account at all (workshop / contract workers without a work email),
    whose user_id is NULL and who are named by full_name.

    For account holders, manager and date of joining are NOT here —
    User.reporting_manager_id and User.date_of_joining stay the single source
    of truth; the profile's own reporting_manager_id / date_of_joining are
    used only when user_id is NULL. Department,
    designation and plant are mirrored back onto the User row by
    services/employee_sync.apply_org_fields.

    PII columns (see PII_FIELDS) may only be returned to hr-app users and to
    the employee themself. Full Aadhaar is never stored — only the last 4."""

    __tablename__ = "hr_employee_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # SM12 optimistic lock (core/optimistic_lock.py): bumped on every UPDATE;
    # a save carrying an older X-Lock-Version gets 409 "changed by X at T".
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    lock_changed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    __mapper_args__ = {"version_id_col": lock_version}
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), unique=True, index=True, nullable=True)
    employee_code: Mapped[str | None] = mapped_column(String(30), unique=True, index=True, nullable=True)
    worker_type: Mapped[str] = mapped_column(String(20), default="office", server_default="office", index=True, nullable=False)

    # --- people without a portal account (user_id NULL) only
    full_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    date_of_joining: Mapped[date | None] = mapped_column(Date, nullable=True)
    reporting_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    # Contract labour: the contractor firm they come through (free text until a contractor master exists).
    contractor_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    contractor_worker_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contractor_contact_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    contractor_contact_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contractor_agreement_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # HR's check of the contractor's papers for this worker (licence, PF/ESI cover).
    contractor_verification: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # The person's own contract period: a fixed-term employee's term, or a
    # contract worker's deployment under the contractor's agreement.
    contract_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Portal provisioning for someone without an account yet: with portal
    # access, the record links to the User with this email — now if the
    # account exists, else on their first sign-in (services/workforce_link.py).
    portal_access: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    work_email: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    # Application role the account gets when the record is linked (Organization › Role & Permissions).
    portal_role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)

    # --- attendance & compliance
    attendance_policy: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Comma list of weekday codes ("sun" / "sat,sun"); blank = the plant calendar.
    weekly_off: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # None = not decided, treated as eligible (as before this field existed).
    ot_eligible: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    medical_clearance_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    medical_fitness_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    safety_induction_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    safety_induction_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # --- exit & record state
    exit_clearance_done: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # Saved with "Save as draft": required-field checks were skipped.
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True, nullable=True)
    designation_id: Mapped[int | None] = mapped_column(ForeignKey("hr_designations.id"), index=True, nullable=True)
    grade_id: Mapped[int | None] = mapped_column(ForeignKey("hr_grades.id"), index=True, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("hr_shifts.id"), index=True, nullable=True)
    # IT0001 KOSTL: who bears this employee's cost (ADP cost allocation, expense claim postings).
    cost_center_id: Mapped[int | None] = mapped_column(ForeignKey("cost_centers.id"), index=True, nullable=True)

    employment_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    employment_status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", index=True, nullable=False)
    probation_status: Mapped[str] = mapped_column(String(20), default="not_applicable", server_default="not_applicable", nullable=False)
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
