from datetime import date, datetime
from pydantic import BaseModel


class MaintenanceWorkOrderTaskPayload(BaseModel):
    sequence: int | None = None
    description: str
    expected_value: str | None = None


class MaintenanceWorkOrderTaskUpdate(BaseModel):
    description: str | None = None
    expected_value: str | None = None
    result: str | None = None
    measured_value: str | None = None
    remarks: str | None = None


class MaintenanceWorkOrderTaskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    sequence: int
    description: str
    expected_value: str | None = None
    result: str | None = None
    measured_value: str | None = None
    remarks: str | None = None
    done_by_id: int | None = None
    done_by_name: str | None = None


class MaintenanceWorkOrderSpareIssuePayload(BaseModel):
    """Issue a spare from Store. Pass spare_id to issue more against an
    existing line, or store_item_id + location_id for a new line."""

    spare_id: int | None = None
    store_item_id: int | None = None
    location_id: int | None = None
    quantity: float
    remarks: str | None = None


class MaintenanceWorkOrderSpareReturnPayload(BaseModel):
    spare_id: int
    quantity: float
    remarks: str | None = None


class MaintenanceWorkOrderSparePlanPayload(BaseModel):
    store_item_id: int
    location_id: int
    qty_planned: float
    remarks: str | None = None


class MaintenanceWorkOrderSpareResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    store_item_id: int
    location_id: int
    qty_planned: float
    qty_issued: float
    qty_returned: float
    unit_cost: float | None  # None without maintenance:work_orders.costs:view
    remarks: str | None = None
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    location_name: str | None = None
    available_qty: float | None = None
    net_cost: float | None = 0


class MaintenanceLabourLogPayload(BaseModel):
    technician_id: int
    start_time: datetime | None = None
    end_time: datetime | None = None
    hours: float | None = None  # computed from start/end when omitted
    hourly_rate: float = 0
    remarks: str | None = None


class MaintenanceLabourLogResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    technician_id: int
    start_time: datetime | None = None
    end_time: datetime | None = None
    hours: float
    hourly_rate: float | None  # None without maintenance:work_orders.costs:view
    remarks: str | None = None
    technician_name: str | None = None
    cost: float | None = 0


class MaintenanceWorkOrderCreate(BaseModel):
    asset_id: int
    wo_type: str = "corrective"
    priority: str = "normal"
    title: str
    description: str | None = None
    machine_down: bool = False
    downtime_start: datetime | None = None
    assigned_to_id: int | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    estimated_hours: float | None = None
    # Permit-to-work needed before the job starts. Blank = Maintenance ›
    # Settings › "Permit required by default".
    permit_required: bool | None = None
    tasks: list[MaintenanceWorkOrderTaskPayload] = []


class MaintenanceWorkOrderUpdate(BaseModel):
    """Editable details only — status moves through the action endpoints."""

    wo_type: str | None = None
    priority: str | None = None
    title: str | None = None
    description: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    estimated_hours: float | None = None
    failure_category: str | None = None
    root_cause: str | None = None
    action_taken: str | None = None
    external_vendor_id: int | None = None
    external_cost: float | None = None
    permit_required: bool | None = None


class MaintenanceWorkOrderAssignPayload(BaseModel):
    assigned_to_id: int


class MaintenanceWorkOrderReasonPayload(BaseModel):
    reason: str


class MaintenanceWorkOrderCompletePayload(BaseModel):
    failure_category: str | None = None
    root_cause: str | None = None
    action_taken: str | None = None
    handed_back_at: datetime | None = None  # machine back in service; defaults to now
    # Main-counter reading at completion — required when the asset has a
    # meter (booked as a measuring document; drives counter-based PM).
    meter_reading: float | None = None


class MaintenanceWorkOrderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    wo_number: str
    asset_id: int
    request_id: int | None = None
    pm_plan_id: int | None = None
    pm_due_date: date | None = None
    wo_type: str
    priority: str
    title: str
    description: str | None = None
    status: str
    machine_down: bool
    assigned_to_id: int | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    estimated_hours: float | None = None
    actual_start: datetime | None = None
    actual_end: datetime | None = None
    downtime_start: datetime | None = None
    downtime_end: datetime | None = None
    downtime_minutes: int | None = None
    failure_category: str | None = None
    root_cause: str | None = None
    action_taken: str | None = None
    hold_reason: str | None = None
    cancel_reason: str | None = None
    external_vendor_id: int | None = None
    # Money is None without maintenance:work_orders.costs:view (maintenance/sensitive.py).
    external_cost: float | None
    labour_cost: float | None
    spares_cost: float | None
    total_cost: float | None
    procured_cost: float | None = 0
    permit_required: bool = False
    meter_reading_at_completion: float | None = None
    pm_trigger: str | None = None
    requester_confirmed_at: datetime | None = None
    requester_comment: str | None = None
    created_by_id: int | None = None
    completed_by_id: int | None = None
    verified_by_id: int | None = None
    verified_at: datetime | None = None
    closed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    tasks: list[MaintenanceWorkOrderTaskResponse] = []
    spares: list[MaintenanceWorkOrderSpareResponse] = []
    labour_logs: list[MaintenanceLabourLogResponse] = []

    # Denormalized display fields, filled in by the route.
    asset_code: str | None = None
    asset_name: str | None = None
    asset_status: str | None = None
    branch_id: int | None = None
    branch_name: str | None = None
    request_number: str | None = None
    pm_plan_code: str | None = None
    requester_id: int | None = None
    requester_name: str | None = None
    assigned_to_name: str | None = None
    external_vendor_name: str | None = None
    verified_by_name: str | None = None
    awaiting_confirmation: bool = False
    live_downtime_minutes: int | None = None
    asset_meter_unit: str | None = None
    asset_meter_reading: float | None = None
    active_permit_number: str | None = None  # the permit that lets the job run
    open_permit_count: int = 0               # issued / active permits not closed yet
