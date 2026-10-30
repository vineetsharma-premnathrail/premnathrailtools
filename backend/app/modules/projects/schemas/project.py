from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.core.priority import DEFAULT_PRIORITY
from app.modules.erp.schemas.project import ProjectCreateOptionalSerial

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
    # Blank = next number of the PEW series (PEW-78 ...; one series with the Order Projects and past machines); or typed, e.g. PEW-64A.
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
    # standard | urgent (app.core.priority); checked in the route.
    priority: str = DEFAULT_PRIORITY
    # Not accepted on create (422 from the route): a Finance budget is linked later from the project's Overview.
    internal_order_id: int | None = None
    # Optional CRM source ('inquiry' | 'tender' + its id), for traceability. Does not freeze the CRM record.
    source_kind: str | None = None
    source_id: int | None = None


class PmProjectWithMachineCreate(BaseModel):
    """'Add New Project': the PM project and its machine in one save. Client and
    customer PO are typed once, on the machine part, and copied to the project
    (they may also be sent on the project part to override)."""
    project_code: str | None = None
    name: str
    client_name: str | None = None
    customer_po_ref: str | None = None
    sales_order_ref: str | None = None
    description: str | None = None
    project_manager_id: int | None = None
    start_date: date
    target_handover_date: date
    priority: str = DEFAULT_PRIORITY
    # Not accepted on create (422 from the route); see PmProjectCreate.
    internal_order_id: int | None = None
    source_kind: str | None = None
    source_id: int | None = None
    machine: ProjectCreateOptionalSerial


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
    # Finance budget to link; null unlinks it.
    internal_order_id: int | None = None
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


class PmStagePayload(BaseModel):
    # One of LIFECYCLE_STAGES (projects/lifecycle.py); reason is required when moving backwards.
    stage: str
    reason: str | None = None


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
    internal_order_id: int | None = None
    internal_order_code: str | None = None
    internal_order_name: str | None = None
    # Optional CRM source this project was created from ('inquiry' | 'tender').
    source_kind: str | None = None
    source_id: int | None = None
    # Order-linked project (made from a confirmed sales order) and where it is in its life.
    sales_order_id: int | None = None
    so_number: str | None = None
    lifecycle_stage: str = "planned"
    lifecycle_stage_label: str | None = None
    units_total: int = 0
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
    # The machine registered with this project (first live one); None for projects without one.
    machine_id: int | None = None
    machine_serial: str | None = None
