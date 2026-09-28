from datetime import date, datetime
from pydantic import BaseModel


class QualityCapaCreate(BaseModel):
    action_type: str
    ncr_id: int | None = None
    complaint_id: int | None = None
    title: str
    root_cause: str | None = None
    action_plan: str
    responsible_user_id: int | None = None
    due_date: date | None = None


class QualityCapaUpdate(BaseModel):
    action_type: str | None = None
    ncr_id: int | None = None
    complaint_id: int | None = None
    title: str | None = None
    root_cause: str | None = None
    action_plan: str | None = None
    responsible_user_id: int | None = None
    due_date: date | None = None
    verification_notes: str | None = None
    status: str | None = None


class QualityCapaResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    capa_number: str
    action_type: str
    ncr_id: int | None = None
    complaint_id: int | None = None
    title: str
    root_cause: str | None = None
    action_plan: str
    responsible_user_id: int | None = None
    due_date: date | None = None
    verification_notes: str | None = None
    status: str
    closed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    responsible_user_name: str | None = None
    ncr_number: str | None = None
