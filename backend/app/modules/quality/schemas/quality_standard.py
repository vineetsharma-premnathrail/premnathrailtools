from datetime import date, datetime
from pydantic import BaseModel


class QualityStandardCreate(BaseModel):
    standard_code: str
    title: str
    category: str | None = None
    description: str | None = None
    effective_date: date | None = None
    status: str = "active"


class QualityStandardUpdate(BaseModel):
    standard_code: str | None = None
    title: str | None = None
    category: str | None = None
    description: str | None = None
    effective_date: date | None = None
    status: str | None = None


class QualityStandardResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    standard_code: str
    title: str
    category: str | None = None
    description: str | None = None
    effective_date: date | None = None
    status: str
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display field, filled in by the route.
    created_by_name: str | None = None
