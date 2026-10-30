from datetime import date, datetime
from pydantic import BaseModel

from app.modules.projects.schemas.document import PmProjectDocumentResponse
from app.modules.projects.schemas.milestone import PmPerson, PmProjectMilestoneResponse


class PmTaskCreate(BaseModel):
    title: str
    description: str | None = None
    assignee_id: int
    due_date: date
    priority: str = "standard"
    estimated_hours: float | None = None


class PmTaskUpdatePayload(BaseModel):
    title: str | None = None
    description: str | None = None
    assignee_id: int | None = None
    due_date: date | None = None
    priority: str | None = None
    estimated_hours: float | None = None


class PmSelfTaskCreate(BaseModel):
    """A team member adding a task for themselves."""
    title: str
    description: str | None = None
    due_date: date
    priority: str = "standard"
    estimated_hours: float | None = None


class PmTimeLogCreate(BaseModel):
    work_date: date
    hours: float
    note: str | None = None


class PmTimeLogResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    task_id: int
    user_id: int
    user_name: str | None = None
    work_date: date
    hours: float
    note: str | None = None
    created_at: datetime | None = None


class PmTaskReasonPayload(BaseModel):
    reason: str


class PmTaskCompletePayload(BaseModel):
    """What was delivered — kept on the task's Done history entry."""
    note: str = ""


class PmTaskCommentPayload(BaseModel):
    comment: str
    mention_user_ids: list[int] = []


class PmSubtaskCreate(BaseModel):
    title: str
    due_date: date | None = None


class PmSubtaskUpdate(BaseModel):
    title: str | None = None
    due_date: date | None = None
    status: str | None = None


class PmSubtaskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    task_id: int
    title: str
    due_date: date | None = None
    status: str
    completed_at: datetime | None = None


class PmTaskUpdateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    task_id: int
    user_id: int | None = None
    user_name: str | None = None
    kind: str
    from_status: str | None = None
    to_status: str | None = None
    comment: str | None = None
    mentions: list[PmPerson] = []
    created_at: datetime | None = None


class PmProjectTaskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    project_code: str | None = None
    project_name: str | None = None
    project_status: str | None = None
    milestone_id: int | None = None
    milestone_title: str | None = None
    milestone_target_date: date | None = None
    milestone_status: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    title: str
    description: str | None = None
    assignee_id: int | None = None
    assignee_name: str | None = None
    status: str
    priority: str
    due_date: date | None = None
    estimated_hours: float | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    blocker_reason: str | None = None
    reopen_reason: str | None = None
    cancel_reason: str | None = None
    created_at: datetime | None = None

    progress_percent: int = 0
    subtasks_total: int = 0
    subtasks_done: int = 0
    is_overdue: bool = False
    is_assignee: bool = False
    is_head: bool = False
    logged_hours: float = 0
    # Added by the assignee for themselves (not given by the lead).
    is_self_created: bool = False


class PmTaskDetailResponse(BaseModel):
    task: PmProjectTaskResponse
    subtasks: list[PmSubtaskResponse]
    updates: list[PmTaskUpdateResponse]
    files: list[PmProjectDocumentResponse]
    time_logs: list[PmTimeLogResponse] = []


class PmMilestoneWorkspaceResponse(BaseModel):
    milestone: PmProjectMilestoneResponse
    # Members see only their own tasks; guests (tagged in chat) see none.
    tasks: list[PmProjectTaskResponse]
    evidence: list[PmProjectDocumentResponse]
    can_manage: bool = False
    can_plan: bool = False
    # manage | lead | member | guest
    role: str = "guest"


class PmCommItem(BaseModel):
    """One line of a project's correspondence log: a WBS chat message, a
    task comment, or a file a department attached (evidence / task file)."""
    key: str
    kind: str  # message | comment | file
    milestone_id: int | None = None
    milestone_title: str | None = None
    milestone_sequence: int | None = None
    department_name: str | None = None
    task_id: int | None = None
    task_title: str | None = None
    user_id: int | None = None
    user_name: str | None = None
    body: str | None = None
    mentions: list[PmPerson] = []
    files: list[PmProjectDocumentResponse] = []
    created_at: datetime | None = None


class PmMessageResponse(BaseModel):
    id: int
    milestone_id: int
    user_id: int | None = None
    user_name: str | None = None
    body: str | None = None
    mentions: list[PmPerson] = []
    files: list[PmProjectDocumentResponse] = []
    created_at: datetime | None = None
