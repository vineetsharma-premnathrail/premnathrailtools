from datetime import date, datetime
from pydantic import BaseModel, Field


class HydServicePartPayload(BaseModel):
    spare_part_id: int
    quantity: float = Field(gt=0)
    remarks: str | None = None


class HydServicePartResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    spare_part_id: int
    quantity: float
    unit_cost: float
    remarks: str | None = None
    issued_location_id: int | None = None

    part_code: str | None = None
    part_name: str | None = None
    uom: str | None = None
    store_linked: bool = False
    issued_location_name: str | None = None
    line_cost: float = 0.0


class HydServiceRecordCreate(BaseModel):
    system_id: int
    plan_id: int | None = None
    service_type: str = "preventive"
    service_date: date
    reported_problem: str | None = None
    root_cause: str | None = None
    work_done: str | None = None
    checklist: str | None = None
    performed_by_id: int | None = None
    external_agency: str | None = Field(None, max_length=200)
    running_hours: float | None = Field(None, ge=0)
    downtime_hours: float = Field(0.0, ge=0)
    fluid_added_l: float = Field(0.0, ge=0)
    oil_condition: str | None = Field(None, max_length=100)
    labour_cost: float = Field(0.0, ge=0)
    other_cost: float = Field(0.0, ge=0)
    next_service_date: date | None = None
    remarks: str | None = None
    parts: list[HydServicePartPayload] = []


class HydServiceRecordUpdate(BaseModel):
    """Open / in-progress only. `parts`, when sent, replaces the full list."""
    service_type: str | None = None
    service_date: date | None = None
    reported_problem: str | None = None
    root_cause: str | None = None
    work_done: str | None = None
    checklist: str | None = None
    performed_by_id: int | None = None
    external_agency: str | None = Field(None, max_length=200)
    running_hours: float | None = Field(None, ge=0)
    downtime_hours: float | None = Field(None, ge=0)
    fluid_added_l: float | None = Field(None, ge=0)
    oil_condition: str | None = Field(None, max_length=100)
    labour_cost: float | None = Field(None, ge=0)
    other_cost: float | None = Field(None, ge=0)
    next_service_date: date | None = None
    remarks: str | None = None
    parts: list[HydServicePartPayload] | None = None


class HydServiceRecordCompletePayload(BaseModel):
    completed_on: date | None = None
    # When set, every part line linked to a Store item is issued from this
    # Store location. Leave empty to record the parts without moving stock.
    issue_from_location_id: int | None = None
    work_done: str | None = None


class HydServiceRecordCancelPayload(BaseModel):
    reason: str = Field(min_length=1)


class HydServiceRecordResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    record_number: str
    system_id: int
    plan_id: int | None = None
    service_type: str
    status: str
    service_date: date
    completed_on: date | None = None
    reported_problem: str | None = None
    root_cause: str | None = None
    work_done: str | None = None
    checklist: str | None = None
    performed_by_id: int | None = None
    external_agency: str | None = None
    running_hours: float | None = None
    downtime_hours: float
    fluid_added_l: float
    oil_condition: str | None = None
    labour_cost: float
    other_cost: float
    next_service_date: date | None = None
    remarks: str | None = None
    cancel_reason: str | None = None
    created_by_id: int | None = None
    completed_by_id: int | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    parts: list[HydServicePartResponse] = []

    # Denormalized display fields, filled in by the route.
    system_number: str | None = None
    system_name: str | None = None
    system_type: str | None = None
    plan_number: str | None = None
    plan_title: str | None = None
    performed_by_name: str | None = None
    completed_by_name: str | None = None
    parts_cost: float = 0.0
    total_cost: float = 0.0
