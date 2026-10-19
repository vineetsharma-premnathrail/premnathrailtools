"""Schemas for HR employee profiles, the employee list, the directory and
the org chart.

PII (see models.employee_profile.PII_FIELDS) only appears on
HrEmployeeProfileResponse, which is returned solely to hr-app users and to
the employee themself. The directory / org-chart DTOs carry no PII."""
import re
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.modules.hr.models.employee_profile import (
    ATTENDANCE_POLICIES, CLEARANCE_STATUSES, EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES, PROBATION_STATUSES, VERIFICATION_STATUSES, WORKER_TYPES,
)

GENDERS = ("male", "female", "other")
MARITAL_STATUSES = ("single", "married", "divorced", "widowed", "other")
BLOOD_GROUPS = ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")

_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^\+?[0-9][0-9\s\-]{6,18}$")
_WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class _PersonalFields(BaseModel):
    """Fields an employee may edit on their own profile."""

    personal_email: str | None = Field(default=None, max_length=255)
    personal_phone: str | None = Field(default=None, max_length=30)
    current_address: str | None = None
    permanent_address: str | None = None
    emergency_contact_name: str | None = Field(default=None, max_length=150)
    emergency_contact_phone: str | None = Field(default=None, max_length=30)
    emergency_contact_relation: str | None = Field(default=None, max_length=50)
    blood_group: str | None = Field(default=None, max_length=10)
    marital_status: str | None = Field(default=None, max_length=20)

    @field_validator("*", mode="before")
    @classmethod
    def _strip(cls, v):
        return _blank_to_none(v)

    @field_validator("personal_email")
    @classmethod
    def _v_email(cls, v):
        if v and not _EMAIL_RE.match(v):
            raise ValueError(f"'{v}' is not a valid email address. Enter it like name@example.com.")
        return v.lower() if v else v

    @field_validator("personal_phone", "emergency_contact_phone")
    @classmethod
    def _v_phone(cls, v):
        if v and not _PHONE_RE.match(v):
            raise ValueError(f"'{v}' is not a valid phone number. Use digits only, optionally starting with + and the country code (e.g. +91 98765 43210).")
        return v

    @field_validator("blood_group")
    @classmethod
    def _v_blood(cls, v):
        if v is None:
            return v
        v = v.upper().replace(" ", "")
        if v not in BLOOD_GROUPS:
            raise ValueError(f"'{v}' is not a blood group. Use one of {', '.join(BLOOD_GROUPS)}.")
        return v

    @field_validator("marital_status")
    @classmethod
    def _v_marital(cls, v):
        if v is None:
            return v
        v = v.lower()
        if v not in MARITAL_STATUSES:
            raise ValueError(f"'{v}' is not a marital status. Use one of {', '.join(MARITAL_STATUSES)}.")
        return v


class HrEmployeeProfileUpdate(_PersonalFields):
    """HR create-or-update payload (PATCH /hr/employees/{user_id}); partial —
    only the fields sent are changed. `reporting_manager_id` and
    `date_of_joining` are written to the User row (single source of truth)."""

    employee_code: str | None = Field(default=None, max_length=30)
    department_id: int | None = None
    designation_id: int | None = None
    grade_id: int | None = None
    branch_id: int | None = None
    shift_id: int | None = None
    cost_center_id: int | None = None  # IT0001 KOSTL — must be active and of the employee's plant
    reporting_manager_id: int | None = None
    date_of_joining: date | None = None
    employment_type: str | None = None
    employment_status: str | None = None
    probation_end_date: date | None = None
    confirmation_date: date | None = None
    date_of_exit: date | None = None
    exit_reason: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    pan_number: str | None = Field(default=None, max_length=20)
    aadhaar_last4: str | None = None  # length checked in _v_aadhaar for a clearer message
    uan_number: str | None = Field(default=None, max_length=20)
    esic_number: str | None = Field(default=None, max_length=20)
    work_location: str | None = Field(default=None, max_length=150)
    org_fields_locked: bool | None = None
    notes: str | None = None
    worker_type: str | None = None
    contractor_name: str | None = Field(default=None, max_length=150)
    contractor_worker_id: str | None = Field(default=None, max_length=50)
    contractor_contact_person: str | None = Field(default=None, max_length=150)
    contractor_contact_phone: str | None = Field(default=None, max_length=30)
    contractor_agreement_ref: str | None = Field(default=None, max_length=100)
    contract_start_date: date | None = None
    contract_end_date: date | None = None
    portal_access: bool | None = None
    work_email: str | None = Field(default=None, max_length=255)
    attendance_policy: str | None = None
    weekly_off: str | None = Field(default=None, max_length=30)
    ot_eligible: bool | None = None
    medical_fitness_date: date | None = None
    safety_induction_date: date | None = None
    exit_clearance_done: bool | None = None
    # True = "Save as draft": skip the required-field checks (record shows as Draft).
    is_draft: bool | None = None
    probation_status: str | None = None
    contractor_verification: str | None = None
    portal_role_id: int | None = None
    safety_induction_status: str | None = None
    medical_clearance_status: str | None = None

    @field_validator("probation_status")
    @classmethod
    def _v_probation(cls, v):
        if v and v not in PROBATION_STATUSES:
            raise ValueError(f"'{v}' is not a probation status. Use one of: {', '.join(PROBATION_STATUSES.values())}.")
        return v

    @field_validator("contractor_verification")
    @classmethod
    def _v_contractor_verification(cls, v):
        if v and v not in VERIFICATION_STATUSES:
            raise ValueError(f"'{v}' is not a verification status. Use one of: {', '.join(VERIFICATION_STATUSES.values())}.")
        return v

    @field_validator("safety_induction_status", "medical_clearance_status")
    @classmethod
    def _v_clearance(cls, v, info):
        allowed = CLEARANCE_STATUSES[info.field_name]
        if v and v not in allowed:
            raise ValueError(f"'{v}' is not valid here. Use one of: {', '.join(allowed.values())}.")
        return v

    @field_validator("attendance_policy")
    @classmethod
    def _v_policy(cls, v):
        if v and v not in ATTENDANCE_POLICIES:
            raise ValueError(f"'{v}' is not an attendance policy. Use one of {', '.join(ATTENDANCE_POLICIES)}.")
        return v

    @field_validator("weekly_off")
    @classmethod
    def _v_weekly_off(cls, v):
        if not v:
            return v
        days = [d.strip().lower()[:3] for d in v.split(",") if d.strip()]
        bad = [d for d in days if d not in _WEEKDAYS]
        if bad:
            raise ValueError(f"'{', '.join(bad)}' is not a weekday. Use mon, tue, wed, thu, fri, sat or sun (comma-separated).")
        if len(set(days)) > 3:
            raise ValueError("More than 3 weekly offs in a week isn't a working pattern. Pick at most 3 days.")
        return ",".join(d for d in _WEEKDAYS if d in days)

    @field_validator("contractor_contact_phone")
    @classmethod
    def _v_contractor_phone(cls, v):
        if v and not _PHONE_RE.match(v):
            raise ValueError(f"'{v}' is not a valid phone number. Use digits only, optionally starting with + and the country code.")
        return v

    @field_validator("employee_code")
    @classmethod
    def _v_code(cls, v):
        return v.upper() if v else v

    @field_validator("employment_type")
    @classmethod
    def _v_type(cls, v):
        if v and v not in EMPLOYMENT_TYPES:
            raise ValueError(f"'{v}' is not an employment type. Use one of {', '.join(EMPLOYMENT_TYPES)}.")
        return v

    @field_validator("worker_type")
    @classmethod
    def _v_worker_type(cls, v):
        if v and v not in WORKER_TYPES:
            raise ValueError(f"'{v}' is not a worker type. Use one of {', '.join(WORKER_TYPES)} ({', '.join(WORKER_TYPES.values())}).")
        return v

    @field_validator("employment_status")
    @classmethod
    def _v_status(cls, v):
        if v and v not in EMPLOYMENT_STATUSES:
            raise ValueError(f"'{v}' is not an employment status. Use one of {', '.join(EMPLOYMENT_STATUSES)}.")
        return v

    @field_validator("gender")
    @classmethod
    def _v_gender(cls, v):
        if v is None:
            return v
        v = v.lower()
        if v not in GENDERS:
            raise ValueError(f"'{v}' is not a gender option. Use one of {', '.join(GENDERS)}.")
        return v

    @field_validator("pan_number")
    @classmethod
    def _v_pan(cls, v):
        if v is None:
            return v
        v = v.upper().replace(" ", "")
        if not _PAN_RE.match(v):
            raise ValueError(f"'{v}' is not a valid PAN. A PAN is 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).")
        return v

    @field_validator("aadhaar_last4")
    @classmethod
    def _v_aadhaar(cls, v):
        if v is None:
            return v
        if not (len(v) == 4 and v.isdigit()):
            raise ValueError("Enter only the last 4 digits of the Aadhaar number. The full Aadhaar number is never stored.")
        return v

    @field_validator("date_of_birth")
    @classmethod
    def _v_dob(cls, v):
        if v and v >= date.today():
            raise ValueError("Date of birth must be in the past. Check the day/month/year.")
        return v


class HrWorkerUpdate(HrEmployeeProfileUpdate):
    """PATCH /hr/employees/workers/{profile_id} — an employee with no portal
    account. Name, joining date and manager live on the profile itself."""

    full_name: str | None = Field(default=None, max_length=150)
    # Portal Access via an account that already exists: link to it directly.
    link_user_id: int | None = None


class HrWorkerCreate(HrWorkerUpdate):
    """POST /hr/employees/workers — add someone who works for us but has no
    work email / portal login (workshop, contract labour)."""

    # Blank strings become None in _strip, so "required" is checked here for a clear message.
    full_name: str | None = Field(default=None, max_length=150, validate_default=True)
    worker_type: str | None = Field(default="factory", validate_default=True)

    @field_validator("full_name")
    @classmethod
    def _v_name(cls, v):
        if not v:
            raise ValueError("Enter the employee's full name — it's how they appear in HR lists without a portal account.")
        return v


class HrEmployeeSelfUpdate(_PersonalFields):
    """PATCH /hr/employees/me — personal fields only, never org fields."""


class HrEmployeeProfileResponse(BaseModel):
    """Full employee record (user + profile), PII included. Only returned to
    HR and to the employee themself."""
    lock_version: int | None = None  # SM12 optimistic lock — echo back as X-Lock-Version

    user_id: int | None = None  # None = no portal account (workshop / contract worker)
    has_profile: bool
    has_login: bool = True
    profile_id: int | None = None
    worker_type: str = "office"
    contractor_name: str | None = None
    name: str
    email: str | None = None
    phone: str | None = None
    is_active: bool = True
    role: str | None = None
    profile_photo_url: str | None = None
    office_location: str | None = None
    # User-level org fields (User row is the source of truth for these two)
    reporting_manager_id: int | None = None
    reporting_manager_name: str | None = None
    reporting_manager_email: str | None = None
    date_of_joining: date | None = None
    # Legacy free-text copies on User (kept in step by apply_org_fields)
    user_department: str | None = None
    user_designation: str | None = None

    employee_code: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    designation_id: int | None = None
    designation_name: str | None = None
    grade_id: int | None = None
    grade_name: str | None = None
    grade_code: str | None = None
    branch_id: int | None = None
    branch_name: str | None = None
    shift_id: int | None = None
    shift_name: str | None = None
    cost_center_id: int | None = None
    employment_type: str | None = None
    employment_status: str | None = None
    probation_end_date: date | None = None
    confirmation_date: date | None = None
    date_of_exit: date | None = None
    exit_reason: str | None = None
    work_location: str | None = None
    org_fields_locked: bool | None = None
    notes: str | None = None

    # PII
    gender: str | None = None
    date_of_birth: date | None = None
    blood_group: str | None = None
    marital_status: str | None = None
    personal_email: str | None = None
    personal_phone: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relation: str | None = None
    current_address: str | None = None
    permanent_address: str | None = None
    pan_number: str | None = None
    aadhaar_last4: str | None = None
    uan_number: str | None = None
    esic_number: str | None = None

    direct_reports_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    created_by_name: str | None = None
    updated_by_name: str | None = None

    # Dynamic workforce form (services/workforce_rules.py)
    contractor_worker_id: str | None = None
    contractor_contact_person: str | None = None
    contractor_contact_phone: str | None = None
    contractor_agreement_ref: str | None = None
    contract_start_date: date | None = None
    contract_end_date: date | None = None
    portal_access: bool = False
    work_email: str | None = None
    attendance_policy: str | None = None
    weekly_off: str | None = None
    ot_eligible: bool | None = None
    medical_fitness_date: date | None = None
    safety_induction_date: date | None = None
    documents_received: list[str] = []  # checklist keys that have an uploaded file
    exit_clearance_done: bool = False
    is_draft: bool = False
    record_status: str | None = None  # draft | incomplete | complete (None = no HR profile yet)
    missing_fields: list[str] = []
    probation_status: str | None = None
    contractor_verification: str | None = None
    portal_role_id: int | None = None
    portal_role_name: str | None = None
    # linked | pending_first_sign_in | not_provisioned | not_required — system-managed
    login_status: str | None = None
    safety_induction_status: str | None = None
    medical_clearance_status: str | None = None


class HrEmployeeListItem(BaseModel):
    """One row of the HR employee list. No PII. Rows without a portal
    account have user_id None and are opened by profile_id."""

    user_id: int | None = None
    profile_id: int | None = None
    has_profile: bool
    has_login: bool = True
    worker_type: str = "office"
    contractor_name: str | None = None
    name: str
    email: str | None = None
    is_active: bool
    profile_photo_url: str | None = None
    employee_code: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    designation_id: int | None = None
    designation_name: str | None = None
    grade_name: str | None = None
    branch_id: int | None = None
    branch_name: str | None = None
    reporting_manager_id: int | None = None
    reporting_manager_name: str | None = None
    date_of_joining: date | None = None
    employment_type: str | None = None
    employment_status: str | None = None
    probation_end_date: date | None = None
    contract_end_date: date | None = None
    record_status: str | None = None  # draft | incomplete | complete (None = no HR profile yet)


class HrEmployeeListResponse(BaseModel):
    items: list[HrEmployeeListItem]
    total: int
    page: int
    page_size: int
    # headline counts over the whole (unfiltered) population
    total_users: int  # active people: portal accounts + workers without one
    with_profile: int
    without_profile: int
    without_login: int = 0  # active workers with no portal account


class HrDirectoryEntry(BaseModel):
    """Directory / org-chart row — deliberately minimal and PII-free."""

    id: int
    name: str
    designation: str | None = None
    department: str | None = None
    branch: str | None = None
    manager_id: int | None = None
    profile_photo_url: str | None = None


class HrOrgChartResponse(BaseModel):
    nodes: list[HrDirectoryEntry]
    root_ids: list[int]
