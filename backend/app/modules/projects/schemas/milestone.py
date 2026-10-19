from datetime import date, datetime
from pydantic import BaseModel


class PmPerson(BaseModel):
    id: int
    name: str


class PmMilestoneCreate(BaseModel):
    title: str
    department_id: int
    # Required — checked in the route so the message says what to do.
    lead_user_id: int | None = None
    assistant_user_ids: list[int] = []
    target_date: date
    deliverable: str
    depends_on_milestone_id: int | None = None
    start_rule: str = "after_previous"


class PmMilestoneUpdate(BaseModel):
    title: str | None = None
    department_id: int | None = None
    lead_user_id: int | None = None
    assistant_user_ids: list[int] | None = None
    target_date: date | None = None
    deliverable: str | None = None
    depends_on_milestone_id: int | None = None
    start_rule: str | None = None
    # Required when the target date changes after the project is Active.
    date_change_reason: str | None = None


class PmMilestoneAcceptPayload(BaseModel):
    actual_date: date | None = None


class PmMilestoneMovePayload(BaseModel):
    direction: str  # up | down


class PmMilestoneTeamPayload(BaseModel):
    assistant_user_ids: list[int]


class PmReasonPayload(BaseModel):
    reason: str


class PmMilestoneSubmitPayload(BaseModel):
    submission_note: str


class PmProjectMilestoneResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    project_code: str | None = None
    project_name: str | None = None
    project_status: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    sequence: int = 0
    lead_user_id: int | None = None
    lead_name: str | None = None
    assistant_user_ids: list[int] | None = None
    assistants: list[PmPerson] = []
    title: str
    deliverable: str | None = None
    depends_on_milestone_id: int | None = None
    depends_on_title: str | None = None
    depends_on_status: str | None = None
    depends_on_sequence: int | None = None
    start_rule: str = "after_previous"
    target_date: date
    original_target_date: date | None = None
    actual_date: date | None = None
    status: str
    submitted_by_name: str | None = None
    submitted_at: datetime | None = None
    submission_note: str | None = None
    achieved_by_name: str | None = None
    achieved_at: datetime | None = None
    return_reason: str | None = None
    cancel_reason: str | None = None
    created_at: datetime | None = None

    progress_percent: int = 0
    forecast_date: date | None = None
    is_overdue: bool = False
    is_at_risk: bool = False
    task_count: int = 0
    tasks_done: int = 0
    tasks_blocked: int = 0
    evidence_count: int = 0
    # Strict order: locked until every earlier step is achieved.
    is_locked: bool = False
    waiting_for_title: str | None = None
    waiting_for_sequence: int | None = None
    waiting_reason: str | None = None
    # Viewer's role: manage | lead | member | guest (set by the department side).
    my_role: str | None = None
