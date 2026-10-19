from datetime import date, datetime
from pydantic import BaseModel


class PmProjectCreate(BaseModel):
    # Blank = next PEW-<year>-NNNN number (one series with the Order Projects).
    project_code: str | None = None
    name: str
    client_name: str
    customer_po_ref: str | None = None
    description: str | None = None
    # Blank = the person creating the project.
    project_manager_id: int | None = None
    start_date: date
    target_handover_date: date
    priority: str = "medium"


class PmProjectUpdate(BaseModel):
    project_code: str | None = None
    name: str | None = None
    client_name: str | None = None
    customer_po_ref: str | None = None
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
