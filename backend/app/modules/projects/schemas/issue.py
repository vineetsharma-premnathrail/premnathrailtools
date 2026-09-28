from datetime import date, datetime
from pydantic import BaseModel


class PmIssueCreate(BaseModel):
    title: str
    description: str | None = None
    severity: str | None = None
    assigned_to_id: int | None = None
    raised_date: date | None = None


class PmIssueUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    severity: str | None = None
    status: str | None = None
    assigned_to_id: int | None = None
    resolved_date: date | None = None
    resolution: str | None = None


class PmIssueResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    title: str
    description: str | None = None
    severity: str
    status: str
    raised_by_id: int | None = None
    assigned_to_id: int | None = None
    raised_date: date
    resolved_date: date | None = None
    resolution: str | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    raised_by_name: str | None = None
    assigned_to_name: str | None = None
