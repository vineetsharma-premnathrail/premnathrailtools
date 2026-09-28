from datetime import date, datetime
from pydantic import BaseModel


class PmProjectResourceCreate(BaseModel):
    user_id: int
    role: str | None = None
    allocation_percent: int | None = None
    start_date: date | None = None
    end_date: date | None = None


class PmProjectResourceUpdate(BaseModel):
    role: str | None = None
    allocation_percent: int | None = None
    start_date: date | None = None
    end_date: date | None = None


class PmProjectResourceResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    user_id: int
    role: str | None = None
    allocation_percent: int | None = None
    start_date: date | None = None
    end_date: date | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display field, filled in by the route.
    user_name: str | None = None
