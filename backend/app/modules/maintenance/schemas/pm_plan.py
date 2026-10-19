from datetime import date, datetime
from pydantic import BaseModel


class MaintenancePmPlanTaskPayload(BaseModel):
    sequence: int | None = None
    description: str
    expected_value: str | None = None


class MaintenancePmPlanTaskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    sequence: int
    description: str
    expected_value: str | None = None


class MaintenancePmPlanSparePayload(BaseModel):
    store_item_id: int
    qty: float = 1.0
    remarks: str | None = None


class MaintenancePmPlanSpareResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    store_item_id: int
    qty: float
    remarks: str | None = None
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None


class MaintenancePmPlanCreate(BaseModel):
    asset_id: int
    title: str
    description: str | None = None
    wo_type: str = "preventive"
    trigger_type: str = "calendar"
    frequency_unit: str = "month"
    frequency_value: int = 1
    schedule_basis: str = "fixed"
    lead_days: int | None = None  # blank = Maintenance › Settings › default PM lead days (3)
    # Required for calendar / calendar_or_meter plans; a pure counter plan
    # may leave it blank.
    next_due_date: date | None = None
    # Counter plans (trigger meter / calendar_or_meter): every meter_interval
    # units of the asset's main counter; next_due_meter blank = current
    # reading + interval; lead_meter = raise the job this many units early.
    meter_interval: float | None = None
    next_due_meter: float | None = None
    lead_meter: float | None = None
    estimated_hours: float | None = None
    default_assignee_id: int | None = None
    requires_shutdown: bool = False
    is_active: bool = True
    tasks: list[MaintenancePmPlanTaskPayload] = []
    spares: list[MaintenancePmPlanSparePayload] = []


class MaintenancePmPlanUpdate(BaseModel):
    """All optional. `tasks` / `spares`, when sent, replace the whole list."""

    asset_id: int | None = None
    title: str | None = None
    description: str | None = None
    wo_type: str | None = None
    trigger_type: str | None = None
    meter_interval: float | None = None
    next_due_meter: float | None = None
    lead_meter: float | None = None
    frequency_unit: str | None = None
    frequency_value: int | None = None
    schedule_basis: str | None = None
    lead_days: int | None = None
    next_due_date: date | None = None
    estimated_hours: float | None = None
    default_assignee_id: int | None = None
    requires_shutdown: bool | None = None
    is_active: bool | None = None
    tasks: list[MaintenancePmPlanTaskPayload] | None = None
    spares: list[MaintenancePmPlanSparePayload] | None = None


class MaintenancePmPlanWorkOrderSummary(BaseModel):
    id: int
    wo_number: str
    status: str
    pm_due_date: date | None = None
    assigned_to_name: str | None = None
    actual_end: datetime | None = None
    closed_at: datetime | None = None
    on_time: bool | None = None  # completed on/before due date; None while open


class MaintenancePmPlanResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    plan_code: str
    asset_id: int
    title: str
    description: str | None = None
    wo_type: str
    trigger_type: str
    frequency_unit: str
    frequency_value: int
    schedule_basis: str
    lead_days: int
    next_due_date: date
    last_done_date: date | None = None
    last_work_order_id: int | None = None
    meter_interval: float | None = None
    last_done_meter: float | None = None
    next_due_meter: float | None = None
    lead_meter: float | None = None
    estimated_hours: float | None = None
    default_assignee_id: int | None = None
    requires_shutdown: bool
    is_active: bool
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    tasks: list[MaintenancePmPlanTaskResponse] = []
    spares: list[MaintenancePmPlanSpareResponse] = []

    # Denormalized display fields, filled in by the route.
    asset_code: str | None = None
    asset_name: str | None = None
    asset_status: str | None = None
    asset_criticality: str | None = None
    branch_id: int | None = None
    branch_name: str | None = None
    default_assignee_name: str | None = None
    last_work_order_number: str | None = None
    open_work_order_id: int | None = None
    open_work_order_number: str | None = None
    open_work_order_status: str | None = None
    frequency_label: str | None = None
    due_state: str | None = None  # overdue | due_soon | scheduled | inactive
    meter_unit: str | None = None
    current_meter_reading: float | None = None
    meter_due_state: str | None = None  # counter plans: overdue | due_soon | scheduled
    recent_work_orders: list[MaintenancePmPlanWorkOrderSummary] = []


class MaintenancePmCalendarEntry(BaseModel):
    """One dot on the PM calendar: either a projected due date of an active
    plan (kind="projected") or an already-generated PM work order."""

    kind: str  # projected | work_order
    date: date
    plan_id: int
    plan_code: str
    title: str
    asset_id: int
    asset_code: str | None = None
    asset_name: str | None = None
    wo_type: str
    state: str  # overdue | due | upcoming | generated statuses (assigned, closed, …)
    work_order_id: int | None = None
    wo_number: str | None = None
    wo_status: str | None = None
    assigned_to_name: str | None = None
