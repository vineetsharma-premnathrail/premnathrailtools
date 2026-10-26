from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

PO_REQUIRED_MSG = "Customer PO number is required. Enter the customer's purchase order number for this project."
SO_REQUIRED_MSG = "Sales order (SO) number is required. Enter the SO number this project is delivered under."


def _clean_ref(value: str | None, message: str) -> str:
    """Trim; blank or missing is an error; plain text only (no link to Sales)."""
    text = (value or "").strip()
    if not text:
        raise ValueError(message)
    if len(text) > 100:
        raise ValueError("The PO and SO numbers can each be at most 100 characters. Shorten the one you entered.")
    return text


class _PoSoCheck(BaseModel):
    @field_validator("customer_po_ref", check_fields=False)
    @classmethod
    def _po(cls, v):
        return _clean_ref(v, PO_REQUIRED_MSG)

    @field_validator("sales_order_ref", check_fields=False)
    @classmethod
    def _so(cls, v):
        return _clean_ref(v, SO_REQUIRED_MSG)


class PmProjectCreate(_PoSoCheck):
    # Blank = next PEW-<year>-NNNN number (one series with the Order Projects).
    project_code: str | None = None
    name: str
    client_name: str
    # Required: a missing key falls to the default None and fails the validator with the real message.
    customer_po_ref: Annotated[str | None, Field(validate_default=True)] = None
    sales_order_ref: Annotated[str | None, Field(validate_default=True)] = None
    description: str | None = None
    # Blank = the person creating the project.
    project_manager_id: int | None = None
    start_date: date
    target_handover_date: date
    priority: str = "medium"


class PmProjectUpdate(_PoSoCheck):
    project_code: str | None = None
    name: str | None = None
    client_name: str | None = None
    # Optional, but once sent they can never be blank (existing projects may still lack them).
    customer_po_ref: str | None = None
    sales_order_ref: str | None = None
    description: str | None = None
    project_manager_id: int | None = None
    start_date: date | None = None
    target_handover_date: date | None = None
    priority: str | None = None
    # Drafted on the Overview closure panel so the Final Project Report includes them.
    closure_note: str | None = None
    lessons_learned: str | None = None


class PmProjectTransitionPayload(BaseModel):
    # activate | hold | resume | complete | close | cancel
    action: str
    reason: str | None = None
    closure_note: str | None = None
    # close only: the PM confirms every project document is filed.
    documents_archived: bool = False
    lessons_learned: str | None = None


class PmClosureCheck(BaseModel):
    key: str
    label: str
    ok: bool
    # Required checks block closing; advisory ones only warn.
    required: bool = True
    detail: str | None = None


class PmClosureResponse(BaseModel):
    status: str
    can_close: bool
    checks: list[PmClosureCheck]


class PmNextMilestone(BaseModel):
    id: int
    title: str
    department_name: str | None = None
    target_date: date
    is_overdue: bool = False


class PmProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_code: str
    name: str
    client_name: str | None = None
    customer_po_ref: str | None = None
    sales_order_ref: str | None = None
    description: str | None = None
    project_manager_id: int | None = None
    project_manager_name: str | None = None
    start_date: date | None = None
    target_handover_date: date | None = None
    status: str
    priority: str
    created_by_id: int | None = None
    created_by_name: str | None = None
    released_by_name: str | None = None
    released_at: datetime | None = None
    hold_reason: str | None = None
    cancel_reason: str | None = None
    closure_date: date | None = None
    closed_by_name: str | None = None
    closure_note: str | None = None
    technically_completed_on: date | None = None
    documents_archived_at: datetime | None = None
    documents_archived_by_name: str | None = None
    lessons_learned: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Computed on read — never typed in.
    progress_percent: int = 0
    milestones_total: int = 0
    milestones_achieved: int = 0
    next_milestone: PmNextMilestone | None = None
    # Departments with an open milestone right now (where the work is).
    current_departments: list[str] = []
    forecast_date: date | None = None
    # on_track | at_risk | delayed (None when not Active)
    health: str | None = None
    can_manage: bool = False
