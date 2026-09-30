from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field

AttendanceStatus = Literal["present", "absent", "half_day", "on_leave", "holiday", "weekly_off", "on_duty", "work_from_home"]
RegularizableStatus = Literal["present", "half_day", "on_duty", "work_from_home"]


# ── Attendance rows ──────────────────────────────────────────────────────
class HrAttendanceCreate(BaseModel):
    """Upsert one employee's attendance for one date (HR)."""

    user_id: int
    attendance_date: date
    status: AttendanceStatus
    check_in: time | None = None
    check_out: time | None = None
    remarks: str | None = Field(None, max_length=1000)


class HrAttendanceBulkPayload(BaseModel):
    attendance_date: date
    user_ids: list[int] = Field(..., min_length=1, max_length=2000)
    status: AttendanceStatus
    remarks: str | None = Field(None, max_length=1000)
    overwrite_existing: bool = True


class HrAttendanceCheckPayload(BaseModel):
    remarks: str | None = Field(None, max_length=500)


class HrAttendanceResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int
    attendance_date: date
    status: str
    check_in: datetime | None = None
    check_out: datetime | None = None
    shift_id: int | None = None
    source: str
    remarks: str | None = None
    marked_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    check_in_time: str | None = None
    check_out_time: str | None = None
    late_minutes: int | None = None


# ── Regularizations ──────────────────────────────────────────────────────
class HrAttendanceRegularizationCreate(BaseModel):
    attendance_date: date
    requested_status: RegularizableStatus
    check_in: time | None = None
    check_out: time | None = None
    reason: str = Field(..., min_length=3, max_length=1000)


class HrAttendanceRegularizationDecisionPayload(BaseModel):
    remarks: str | None = Field(None, max_length=1000)


class HrAttendanceRegularizationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    request_no: str
    user_id: int
    attendance_date: date
    requested_status: str
    check_in: datetime | None = None
    check_out: datetime | None = None
    reason: str | None = None
    status: str
    approver_id: int | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    check_in_time: str | None = None
    check_out_time: str | None = None
    user_name: str | None = None
    user_email: str | None = None
    employee_code: str | None = None
    department_name: str | None = None
    approver_name: str | None = None
    decided_by_name: str | None = None
    current_status: str | None = None
    can_decide: bool = False
    can_cancel: bool = False
