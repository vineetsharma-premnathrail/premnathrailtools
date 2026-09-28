from datetime import datetime
from pydantic import BaseModel


class ClosePeriodPayload(BaseModel):
    notes: str | None = None


class ReopenPeriodPayload(BaseModel):
    reason: str


class PeriodCloseResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int | None = None
    accounting_period: str
    status: str
    closed_by_id: int | None = None
    closed_by_name: str | None = None
    closed_at: datetime | None = None
    close_notes: str | None = None
    reopened_by_id: int | None = None
    reopened_by_name: str | None = None
    reopened_at: datetime | None = None
    reopen_reason: str | None = None
