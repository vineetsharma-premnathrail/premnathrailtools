from datetime import date, datetime
from pydantic import BaseModel


class ElectricalWorkOrderCreate(BaseModel):
    project_id: int
    equipment_tag: str | None = None
    voltage_system: str | None = None
    fault_type: str | None = None
    description: str | None = None
    source_service_request_id: int | None = None
    priority: str = "medium"
    expected_completion_date: date | None = None


class ElectricalWorkOrderUpdate(BaseModel):
    equipment_tag: str | None = None
    voltage_system: str | None = None
    fault_type: str | None = None
    description: str | None = None
    priority: str | None = None
    expected_completion_date: date | None = None
    resolution_notes: str | None = None


class ElectricalWorkOrderAssignPayload(BaseModel):
    assigned_to_id: int


class ElectricalWorkOrderStatusPayload(BaseModel):
    status: str
    resolution_notes: str | None = None


class ElectricalWorkOrderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    work_order_number: str
    project_id: int
    equipment_tag: str | None = None
    voltage_system: str | None = None
    fault_type: str | None = None
    description: str | None = None
    source_service_request_id: int | None = None
    status: str
    priority: str
    assigned_to_id: int | None = None
    raised_by_id: int | None = None
    expected_completion_date: date | None = None
    resolved_at: datetime | None = None
    closed_at: datetime | None = None
    resolution_notes: str | None = None
    created_at: datetime | None = None

    # Denormalized, filled in by the route.
    project_label: str | None = None
    assigned_to_name: str | None = None
    raised_by_name: str | None = None
