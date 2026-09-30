from datetime import date, datetime
from pydantic import BaseModel, Field


class HydMaintenancePlanCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    system_id: int
    maintenance_type: str = "preventive"
    frequency_days: int | None = Field(None, ge=1)
    frequency_hours: float | None = Field(None, gt=0)
    start_date: date | None = None
    last_done_date: date | None = None
    last_done_hours: float | None = Field(None, ge=0)
    assigned_to_id: int | None = None
    checklist: str | None = None
    is_active: bool = True
    remarks: str | None = None


class HydMaintenancePlanUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    maintenance_type: str | None = None
    frequency_days: int | None = Field(None, ge=1)
    frequency_hours: float | None = Field(None, gt=0)
    start_date: date | None = None
    last_done_date: date | None = None
    last_done_hours: float | None = Field(None, ge=0)
    assigned_to_id: int | None = None
    checklist: str | None = None
    is_active: bool | None = None
    remarks: str | None = None


class HydMaintenancePlanResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    plan_number: str
    title: str
    system_id: int
    maintenance_type: str
    frequency_days: int | None = None
    frequency_hours: float | None = None
    start_date: date | None = None
    last_done_date: date | None = None
    last_done_hours: float | None = None
    next_due_date: date | None = None
    assigned_to_id: int | None = None
    checklist: str | None = None
    is_active: bool
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    system_number: str | None = None
    system_name: str | None = None
    system_type: str | None = None
    system_running_hours: float | None = None
    next_due_hours: float | None = None
    assigned_to_name: str | None = None
    # overdue | due_soon | ok | inactive — whichever of date/hours is nearer.
    due_status: str = "ok"
    days_to_due: int | None = None
    open_service_record_id: int | None = None
