from datetime import date, datetime
from pydantic import BaseModel


class PmProjectTaskCreate(BaseModel):
    phase_id: int | None = None
    parent_task_id: int | None = None
    title: str
    description: str | None = None
    assignee_id: int | None = None
    priority: str = "medium"
    start_date: date | None = None
    due_date: date | None = None


class PmProjectTaskUpdate(BaseModel):
    phase_id: int | None = None
    parent_task_id: int | None = None
    title: str | None = None
    description: str | None = None
    assignee_id: int | None = None
    status: str | None = None
    priority: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    percent_complete: int | None = None


class PmProjectTaskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    phase_id: int | None = None
    parent_task_id: int | None = None
    title: str
    description: str | None = None
    assignee_id: int | None = None
    status: str
    priority: str
    start_date: date | None = None
    due_date: date | None = None
    percent_complete: int

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display field, filled in by the route.
    assignee_name: str | None = None
