from datetime import datetime
from pydantic import BaseModel


class MaintenanceRequestCreate(BaseModel):
    asset_id: int
    request_type: str = "breakdown"
    machine_down: bool = False
    reported_at: datetime | None = None  # defaults to now; may be back-dated
    problem_description: str
    priority: str | None = None  # defaults from asset criticality + machine_down


class MaintenanceRequestRejectPayload(BaseModel):
    status: str = "rejected"  # rejected | duplicate
    reason: str


class MaintenanceRequestConvertPayload(BaseModel):
    title: str | None = None
    wo_type: str | None = None
    priority: str | None = None
    assigned_to_id: int | None = None
    planned_start: str | None = None
    description: str | None = None


class MaintenanceRequestConfirmPayload(BaseModel):
    ok: bool
    comment: str | None = None


class MaintenanceRequestWorkOrderSummary(BaseModel):
    id: int
    wo_number: str
    status: str
    assigned_to_name: str | None = None
    action_taken: str | None = None
    root_cause: str | None = None
    downtime_minutes: int | None = None
    requester_confirmed_at: datetime | None = None


class MaintenanceRequestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    request_number: str
    asset_id: int
    request_type: str
    machine_down: bool
    reported_at: datetime
    problem_description: str
    priority: str
    status: str
    raised_by_id: int | None = None
    acknowledged_by_id: int | None = None
    acknowledged_at: datetime | None = None
    rejection_reason: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    asset_code: str | None = None
    asset_name: str | None = None
    asset_criticality: str | None = None
    asset_status: str | None = None
    branch_name: str | None = None
    raised_by_name: str | None = None
    acknowledged_by_name: str | None = None
    work_order: MaintenanceRequestWorkOrderSummary | None = None
    can_confirm: bool = False
