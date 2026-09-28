from datetime import date, datetime
from pydantic import BaseModel


class PmDeliverableCreate(BaseModel):
    milestone_id: int | None = None
    name: str
    description: str | None = None
    owner_id: int | None = None
    due_date: date | None = None


class PmDeliverableUpdate(BaseModel):
    milestone_id: int | None = None
    name: str | None = None
    description: str | None = None
    owner_id: int | None = None
    due_date: date | None = None
    status: str | None = None


class PmDeliverableResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    milestone_id: int | None = None
    name: str
    description: str | None = None
    owner_id: int | None = None
    due_date: date | None = None
    status: str

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    owner_name: str | None = None
    milestone_title: str | None = None
