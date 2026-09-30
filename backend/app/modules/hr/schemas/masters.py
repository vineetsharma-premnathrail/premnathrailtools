"""Schemas for the HR masters: grades, designations and shifts.

Order per entity follows the project convention: Create -> Update ->
Response (denormalized display fields at the bottom)."""
from datetime import datetime, time
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


def _clean_code(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().upper()
    if not v:
        raise ValueError("Code cannot be blank. Enter a short code such as 'E2' or 'GEN'.")
    return v


def _clean_name(v: str | None) -> str | None:
    if v is None:
        return v
    v = " ".join(v.split())
    if not v:
        raise ValueError("Name cannot be blank.")
    return v


class _CodeNameClean(BaseModel):
    """Trims/uppercases `code` and collapses whitespace in `name`."""

    @field_validator("code", check_fields=False)
    @classmethod
    def _v_code(cls, v):
        return _clean_code(v)

    @field_validator("name", check_fields=False)
    @classmethod
    def _v_name(cls, v):
        return _clean_name(v)


# ---------------------------------------------------------------- Grades

class HrGradeCreate(_CodeNameClean):
    code: str = Field(max_length=30)
    name: str = Field(max_length=100)
    level: int = Field(default=0, ge=0, le=100)
    description: str | None = None
    is_active: bool = True



class HrGradeUpdate(_CodeNameClean):
    code: str | None = Field(default=None, max_length=30)
    name: str | None = Field(default=None, max_length=100)
    level: int | None = Field(default=None, ge=0, le=100)
    description: str | None = None
    is_active: bool | None = None



class HrGradeResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    level: int
    description: str | None = None
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # usage counts, so the UI can explain why delete is blocked
    employee_count: int = 0


# ---------------------------------------------------------------- Designations

class HrDesignationCreate(_CodeNameClean):
    name: str = Field(max_length=150)
    code: str = Field(max_length=30)
    department_id: int | None = None
    grade_id: int | None = None
    description: str | None = None
    is_active: bool = True



class HrDesignationUpdate(_CodeNameClean):
    name: str | None = Field(default=None, max_length=150)
    code: str | None = Field(default=None, max_length=30)
    department_id: int | None = None
    grade_id: int | None = None
    description: str | None = None
    is_active: bool | None = None



class HrDesignationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    code: str
    department_id: int | None = None
    grade_id: int | None = None
    description: str | None = None
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
    department_name: str | None = None
    grade_name: str | None = None
    grade_code: str | None = None
    employee_count: int = 0


# ---------------------------------------------------------------- Shifts

class HrShiftCreate(_CodeNameClean):
    code: str = Field(max_length=30)
    name: str = Field(max_length=100)
    start_time: time
    end_time: time
    grace_minutes: int = Field(default=10, ge=0, le=240)
    working_hours: Decimal | None = Field(default=None, ge=0, le=24)
    is_night: bool | None = None  # None = work it out from start/end
    branch_id: int | None = None
    is_active: bool = True



class HrShiftUpdate(_CodeNameClean):
    code: str | None = Field(default=None, max_length=30)
    name: str | None = Field(default=None, max_length=100)
    start_time: time | None = None
    end_time: time | None = None
    grace_minutes: int | None = Field(default=None, ge=0, le=240)
    working_hours: Decimal | None = Field(default=None, ge=0, le=24)
    is_night: bool | None = None
    branch_id: int | None = None
    is_active: bool | None = None



class HrShiftResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    start_time: time
    end_time: time
    grace_minutes: int
    working_hours: Decimal | None = None
    is_night: bool
    branch_id: int | None = None
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
    branch_name: str | None = None
    employee_count: int = 0


# ---------------------------------------------------------------- Lookups

class HrLookupOption(BaseModel):
    id: int
    name: str
    code: str | None = None
    is_active: bool = True


class HrLookupUser(BaseModel):
    id: int
    name: str
    email: str
    designation: str | None = None
    department: str | None = None
    is_active: bool = True


class HrLookupsResponse(BaseModel):
    """Everything the HR forms need for their dropdowns in one call. The
    organization department/plant endpoints are admin-only, so HR screens
    read them from here instead."""
    departments: list[HrLookupOption]
    branches: list[HrLookupOption]
    designations: list[HrLookupOption]
    grades: list[HrLookupOption]
    shifts: list[HrLookupOption]
    users: list[HrLookupUser]
