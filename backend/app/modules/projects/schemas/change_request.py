from datetime import datetime
from pydantic import BaseModel


class PmChangeRequestCreate(BaseModel):
    title: str
    description: str | None = None
    impact_assessment: str | None = None


class PmChangeRequestUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    impact_assessment: str | None = None
    status: str | None = None


class PmChangeRequestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    title: str
    description: str | None = None
    impact_assessment: str | None = None
    status: str
    requested_by_id: int | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    requested_by_name: str | None = None
    decided_by_name: str | None = None
