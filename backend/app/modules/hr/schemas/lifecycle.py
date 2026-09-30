"""Schemas for HR lifecycle events (joiner / mover / leaver) and their
checklist items. Order follows the project convention: item DTOs, Create,
Update, action payloads, Response."""
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


# ── Checklist items ─────────────────────────────────────────────────────

class HrChecklistItemCreate(BaseModel):
    category: str
    title: str = Field(min_length=1, max_length=255)
    owner_user_id: int | None = None
    remarks: str | None = None
    sort_order: int | None = None


class HrChecklistItemUpdate(BaseModel):
    """HR may change every field; an item owner without the hr app may
    change only `status` and `remarks`."""
    category: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    owner_user_id: int | None = None
    status: str | None = None
    remarks: str | None = None
    sort_order: int | None = None


class HrChecklistItemResponse(BaseModel):
    id: int
    event_id: int
    template_id: int | None = None
    category: str
    title: str
    owner_user_id: int | None = None
    status: str
    done_by_id: int | None = None
    done_at: datetime | None = None
    remarks: str | None = None
    sort_order: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    owner_name: str | None = None
    done_by_name: str | None = None
    can_edit: bool = False


class HrChecklistTaskResponse(HrChecklistItemResponse):
    """A checklist item shown in "my tasks", with its event context."""
    event_no: str | None = None
    event_type: str | None = None
    event_status: str | None = None
    subject_name: str | None = None


# ── Lifecycle events ────────────────────────────────────────────────────

class HrLifecycleEventCreate(BaseModel):
    event_type: str
    user_id: int | None = None
    candidate_name: str | None = Field(default=None, max_length=150)
    candidate_email: str | None = Field(default=None, max_length=255)
    status: str | None = None  # 'draft' or 'in_progress' (default)
    effective_date: date | None = None

    to_department_id: int | None = None
    to_branch_id: int | None = None
    to_designation_id: int | None = None
    to_grade_id: int | None = None
    to_manager_id: int | None = None

    resignation_date: date | None = None
    last_working_day: date | None = None
    exit_type: str | None = None
    exit_reason: str | None = None
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    handover_to_id: int | None = None
    remarks: str | None = None


class HrLifecycleEventUpdate(BaseModel):
    candidate_name: str | None = Field(default=None, max_length=150)
    candidate_email: str | None = Field(default=None, max_length=255)
    status: str | None = None  # only 'draft' <-> 'in_progress' here
    effective_date: date | None = None

    to_department_id: int | None = None
    to_branch_id: int | None = None
    to_designation_id: int | None = None
    to_grade_id: int | None = None
    to_manager_id: int | None = None

    resignation_date: date | None = None
    last_working_day: date | None = None
    exit_type: str | None = None
    exit_reason: str | None = None
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    handover_to_id: int | None = None
    remarks: str | None = None


class HrLifecycleEventCancelPayload(BaseModel):
    reason: str = Field(min_length=1)


class HrLifecycleEventLinkUserPayload(BaseModel):
    """Either an explicit portal user id, or leave both empty to look the
    user up by the event's candidate_email (case-insensitive)."""
    user_id: int | None = None
    email: str | None = None


class HrLifecycleEventCompletePayload(BaseModel):
    # Joining
    employment_type: str | None = None
    employee_code: str | None = Field(default=None, max_length=30)
    probation_end_date: date | None = None
    # Transfer / promotion: approval-authority clean-up
    clear_head_flags: list[str] = Field(default_factory=list)  # is_department_head / is_project_head / is_plant_head
    department_head_slots: str = "keep"  # keep | remove | reassign (from_department's head slots held by the mover)
    reassign_pending_approvals: bool = False  # move in-flight P2P / HR approvals to handover_to_id
    # Exit (and mover reassignment)
    handover_to_id: int | None = None
    force: bool = False
    force_reason: str | None = None
    remarks: str | None = None


class HrLifecycleEventResponse(BaseModel):
    id: int
    event_no: str
    event_type: str
    user_id: int | None = None
    candidate_name: str | None = None
    candidate_email: str | None = None
    status: str
    effective_date: date | None = None

    from_department_id: int | None = None
    to_department_id: int | None = None
    from_branch_id: int | None = None
    to_branch_id: int | None = None
    from_designation_id: int | None = None
    to_designation_id: int | None = None
    from_grade_id: int | None = None
    to_grade_id: int | None = None
    from_manager_id: int | None = None
    to_manager_id: int | None = None

    resignation_date: date | None = None
    last_working_day: date | None = None
    exit_type: str | None = None
    exit_reason: str | None = None
    notice_period_days: int | None = None
    handover_to_id: int | None = None
    remarks: str | None = None
    completion_summary: dict[str, Any] | None = None

    created_by_id: int | None = None
    completed_by_id: int | None = None
    completed_at: datetime | None = None
    cancelled_reason: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    subject_name: str | None = None
    subject_email: str | None = None
    user_name: str | None = None
    user_email: str | None = None
    employee_code: str | None = None
    from_department_name: str | None = None
    to_department_name: str | None = None
    from_branch_name: str | None = None
    to_branch_name: str | None = None
    from_designation_name: str | None = None
    to_designation_name: str | None = None
    from_grade_name: str | None = None
    to_grade_name: str | None = None
    from_manager_name: str | None = None
    to_manager_name: str | None = None
    handover_to_name: str | None = None
    created_by_name: str | None = None
    completed_by_name: str | None = None
    items_total: int = 0
    items_pending: int = 0
    items: list[HrChecklistItemResponse] = Field(default_factory=list)
    is_hr_view: bool = True
