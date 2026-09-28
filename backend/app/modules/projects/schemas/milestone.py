from datetime import date, datetime
from pydantic import BaseModel


class PmProjectMilestoneCreate(BaseModel):
    phase_id: int | None = None
    title: str
    description: str | None = None
    target_date: date


class PmProjectMilestoneUpdate(BaseModel):
    phase_id: int | None = None
    title: str | None = None
    description: str | None = None
    target_date: date | None = None
    status: str | None = None
    actual_date: date | None = None


class PmProjectMilestoneResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    phase_id: int | None = None
    title: str
    description: str | None = None
    target_date: date
    actual_date: date | None = None
    status: str

    created_at: datetime | None = None
    updated_at: datetime | None = None
