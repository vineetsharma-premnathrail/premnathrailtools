"""Schemas for HR employee profiles, the employee list, the directory and
the org chart.

PII (see models.employee_profile.PII_FIELDS) only appears on
HrEmployeeProfileResponse, which is returned solely to hr-app users and to
the employee themself. The directory / org-chart DTOs carry no PII."""
import re
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.modules.hr.models.employee_profile import EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES

GENDERS = ("male", "female", "other")
MARITAL_STATUSES = ("single", "married", "divorced", "widowed", "other")
BLOOD_GROUPS = ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")

_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^\+?[0-9][0-9\s\-]{6,18}$")


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


class HrEmployeeSelfUpdate(_PersonalFields):
    """PATCH /hr/employees/me — personal fields only, never org fields."""


class HrEmployeeProfileResponse(BaseModel):
    """Full employee record (user + profile), PII included. Only returned to
    HR and to the employee themself."""

    user_id: int
    has_profile: bool
    profile_id: int | None = None
    name: str
    email: str
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


class HrEmployeeListItem(BaseModel):
    """One row of the HR employee list. No PII."""

    user_id: int
    has_profile: bool
    name: str
    email: str
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


class HrEmployeeListResponse(BaseModel):
    items: list[HrEmployeeListItem]
    total: int
    page: int
    page_size: int
    # headline counts over the whole (unfiltered) population
    total_users: int
    with_profile: int
    without_profile: int


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
