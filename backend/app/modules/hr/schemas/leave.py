from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

LeaveSession = Literal["full", "first_half", "second_half"]


# ── Leave types ──────────────────────────────────────────────────────────
class HrLeaveTypeCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=100)
    annual_quota: Decimal = Field(Decimal("0"), ge=0, le=365)
    is_paid: bool = True
    carry_forward: bool = False
    max_carry_forward: Decimal = Field(Decimal("0"), ge=0, le=365)
    allow_half_day: bool = True
    requires_document_after_days: int | None = Field(None, ge=0, le=365)
    gender_restriction: Literal["female", "male"] | None = None
    max_consecutive_days: int | None = Field(None, ge=1, le=365)
    is_active: bool = True
    sort_order: int = 0

    @field_validator("code")
    @classmethod
    def _upper_code(cls, v: str) -> str:
        return v.strip().upper()


class HrLeaveTypeUpdate(BaseModel):
    code: str | None = Field(None, min_length=1, max_length=20)
    name: str | None = Field(None, min_length=1, max_length=100)
    annual_quota: Decimal | None = Field(None, ge=0, le=365)
    is_paid: bool | None = None
    carry_forward: bool | None = None
    max_carry_forward: Decimal | None = Field(None, ge=0, le=365)
    allow_half_day: bool | None = None
    requires_document_after_days: int | None = Field(None, ge=0, le=365)
    gender_restriction: Literal["female", "male"] | None = None
    max_consecutive_days: int | None = Field(None, ge=1, le=365)
    is_active: bool | None = None
    sort_order: int | None = None

    @field_validator("code")
    @classmethod
    def _upper_code(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v


class HrLeaveTypeResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    annual_quota: Decimal
    is_paid: bool
    carry_forward: bool
    max_carry_forward: Decimal
    allow_half_day: bool
    requires_document_after_days: int | None = None
    gender_restriction: str | None = None
    max_consecutive_days: int | None = None
    is_active: bool
    sort_order: int
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ── Balances ─────────────────────────────────────────────────────────────
class HrLeaveBalanceAllotPayload(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    leave_type_ids: list[int] | None = None
    prorate_joiners: bool = True


class HrLeaveBalanceAdjustPayload(BaseModel):
    user_id: int
    leave_type_id: int
    year: int = Field(..., ge=2000, le=2100)
    delta: Decimal = Field(..., ge=-365, le=365)
    reason: str = Field(..., min_length=3, max_length=500)

    @field_validator("delta")
    @classmethod
    def _half_steps(cls, v: Decimal) -> Decimal:
        if v == 0:
            raise ValueError("Adjustment can't be 0 — enter a positive number to add days or a negative number to deduct.")
        if (v * 2) % 1 != 0:
            raise ValueError("Adjust in steps of 0.5 day (e.g. 1, 1.5, -0.5).")
        return v


class HrLeaveBalanceResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int
    leave_type_id: int
    year: int
    opening: Decimal
    allotted: Decimal
    adjusted: Decimal
    used: Decimal
    available: Decimal
    pending: Decimal = Decimal("0")
    updated_at: datetime | None = None
    user_name: str | None = None
    user_email: str | None = None
    employee_code: str | None = None
    department_name: str | None = None
    leave_type_code: str | None = None
    leave_type_name: str | None = None
    is_paid: bool | None = None


# ── Requests ─────────────────────────────────────────────────────────────
class HrLeaveRequestPreviewPayload(BaseModel):
    leave_type_id: int
    from_date: date
    to_date: date
    from_session: LeaveSession = "full"
    to_session: LeaveSession = "full"
    has_attachment: bool = False
    user_id: int | None = None  # HR previewing on behalf of someone


class HrLeaveRequestDecisionPayload(BaseModel):
    remarks: str | None = Field(None, max_length=1000)


class HrLeaveDayPortion(BaseModel):
    date: date
    kind: str
    portion: Decimal
    holiday_name: str | None = None


class HrLeaveRequestPreviewResponse(BaseModel):
    days: Decimal
    breakdown: list[HrLeaveDayPortion]
    errors: list[str]
    warnings: list[str]
    document_required: bool
    balance_checked: bool
    balance_available: Decimal | None = None
    balance_pending: Decimal = Decimal("0")
    approver_id: int | None = None
    approver_name: str | None = None


class HrLeaveRequestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    request_no: str
    user_id: int
    leave_type_id: int
    from_date: date
    to_date: date
    from_session: str
    to_session: str
    days: Decimal
    reason: str | None = None
    contact_during_leave: str | None = None
    attachment_url: str | None = None
    attachment_path: str | None = None
    status: str
    approver_id: int | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_remarks: str | None = None
    cancelled_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    user_name: str | None = None
    user_email: str | None = None
    employee_code: str | None = None
    department_name: str | None = None
    leave_type_code: str | None = None
    leave_type_name: str | None = None
    approver_name: str | None = None
    decided_by_name: str | None = None
    attachment_name: str | None = None
    can_decide: bool = False
    can_cancel: bool = False
