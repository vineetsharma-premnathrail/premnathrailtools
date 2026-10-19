from datetime import date, datetime

from pydantic import BaseModel, Field


class HrOvertimeCreate(BaseModel):
    """Employee claims the overtime time evaluation computed for one day."""

    work_date: date
    reason: str = Field(..., min_length=3, max_length=1000)
    # Optional lower claim (never more than computed).
    claimed_minutes: int | None = Field(None, ge=1, le=1440)


class HrOvertimeGeneratePayload(BaseModel):
    """HR raises OT approvals for every computed-OT day of a month that has
    no live request yet."""

    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    branch_id: int | None = None
    department_id: int | None = None
    user_ids: list[int] | None = Field(None, max_length=2000)


class HrOvertimeDecisionPayload(BaseModel):
    remarks: str | None = Field(None, max_length=1000)
    # Approve fewer minutes than claimed (approve only).
    approved_minutes: int | None = Field(None, ge=1, le=1440)


class HrOvertimeResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    request_no: str
    user_id: int
    work_date: date
    computed_minutes: int
    claimed_minutes: int
    approved_minutes: int | None = None
    status: str
    source: str
    reason: str | None = None
    approver_id: int | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_remarks: str | None = None
    created_at: datetime | None = None

    user_name: str | None = None
    user_email: str | None = None
    employee_code: str | None = None
    department_name: str | None = None
    approver_name: str | None = None
    decided_by_name: str | None = None
    # Today's evaluation of that day (punches may have been corrected since).
    current_ot_minutes: int | None = None
    check_in_time: str | None = None
    check_out_time: str | None = None
    worked_minutes: int | None = None
    can_decide: bool = False
    can_cancel: bool = False
    approval_request_id: int | None = None
