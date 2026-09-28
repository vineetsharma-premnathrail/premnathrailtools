from datetime import date, datetime
from pydantic import BaseModel


class QualityNcrCreate(BaseModel):
    source: str
    severity: str = "minor"
    inspection_id: int | None = None
    item_name: str
    item_code: str | None = None
    description: str
    root_cause: str | None = None
    ncr_date: date
    remarks: str | None = None


class QualityNcrUpdate(BaseModel):
    source: str | None = None
    severity: str | None = None
    inspection_id: int | None = None
    item_name: str | None = None
    item_code: str | None = None
    description: str | None = None
    root_cause: str | None = None
    ncr_date: date | None = None
    remarks: str | None = None
    status: str | None = None


class QualityNcrResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    ncr_number: str
    source: str
    severity: str
    status: str
    inspection_id: int | None = None
    item_name: str
    item_code: str | None = None
    description: str
    root_cause: str | None = None
    raised_by_id: int | None = None
    ncr_date: date
    closed_at: datetime | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    raised_by_name: str | None = None
    inspection_number: str | None = None
