from datetime import date, datetime
from pydantic import BaseModel


class PmProjectPhaseCreate(BaseModel):
    name: str
    planned_start: date | None = None
    planned_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    sort_order: int = 0


class PmProjectPhaseUpdate(BaseModel):
    name: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    status: str | None = None
    sort_order: int | None = None


class PmProjectPhaseResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    name: str
    planned_start: date | None = None
    planned_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    status: str
    sort_order: int

    created_at: datetime | None = None
    updated_at: datetime | None = None
