"""Read-only response models for the shop-floor queue, planning, dashboard,
reports and lookup endpoints — none of these map to a single table."""
from datetime import date
from pydantic import BaseModel


class ProductionQueueEntry(BaseModel):
    operation_id: int
    work_order_id: int
    wo_number: str
    wo_status: str
    priority: str
    product_code: str | None = None
    product_name: str | None = None
    project_label: str | None = None
    quantity_planned: float
    sequence: int
    operation_name: str
    status: str
    workstation_id: int | None = None
    workstation_name: str | None = None
    planned_hours: float
    actual_hours: float
    qty_good: float
    qty_scrap: float
    requires_inspection: bool
    inspection_number: str | None = None
    inspection_status: str | None = None
    planned_end_date: date | None = None
    is_overdue: bool = False
    instructions: str | None = None


class ProductionRequirementOrder(BaseModel):
    work_order_id: int
    wo_number: str
    status: str
    outstanding_qty: float
    planned_start_date: date | None = None


class ProductionMaterialRequirement(BaseModel):
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    outstanding_qty: float
    # Already held for these orders by their Store reservations.
    reserved_qty: float = 0.0
    # Free stock (on hand minus every reservation) across all locations.
    available_qty: float
    shortage_qty: float
    reorder_level: float | None = None
    # Set when the item has its own active BOM: a sub-assembly to build, not buy.
    make_bom_id: int | None = None
    orders: list[ProductionRequirementOrder] = []


class ProductionWorkstationLoad(BaseModel):
    workstation_id: int | None = None
    workstation_name: str
    status: str | None = None
    capacity_hours_per_day: float
    open_operations: int
    remaining_hours: float
    # remaining_hours / capacity — how many working days of queued work.
    load_days: float | None = None


class ProductionScheduleEntry(BaseModel):
    work_order_id: int
    wo_number: str
    status: str
    priority: str
    product_name: str | None = None
    quantity_planned: float
    quantity_completed: float
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    progress_percent: float
    is_overdue: bool


class ProductionPlanningResponse(BaseModel):
    requirements: list[ProductionMaterialRequirement]
    workstation_load: list[ProductionWorkstationLoad]
    schedule: list[ProductionScheduleEntry]


class ProductionDashboardKpis(BaseModel):
    draft: int
    released: int
    in_progress: int
    completed: int
    overdue: int
    output_30d: float
    scrap_30d: float
    hours_30d: float
    pending_inspections: int
    shortage_items: int
    active_boms: int
    active_workstations: int


class ProductionDashboardResponse(BaseModel):
    kpis: ProductionDashboardKpis
    recent: list[ProductionScheduleEntry]
    due_soon: list[ProductionScheduleEntry]


class ProductionOutputRow(BaseModel):
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    quantity: float
    work_orders: int


class ProductionCostRow(BaseModel):
    work_order_id: int
    wo_number: str
    status: str
    product_name: str | None = None
    quantity_planned: float
    quantity_completed: float
    quantity_scrapped: float
    estimated_total_cost: float
    actual_total_cost: float
    variance: float
    variance_percent: float | None = None
    cost_per_unit: float | None = None


class ProductionUtilizationRow(BaseModel):
    workstation_id: int | None = None
    workstation_name: str
    hours_logged: float
    capacity_hours: float
    utilization_percent: float | None = None
    qty_good: float
    qty_scrap: float


class ProductionReportResponse(BaseModel):
    date_from: date
    date_to: date
    output: list[ProductionOutputRow]
    costs: list[ProductionCostRow]
    utilization: list[ProductionUtilizationRow]
    total_output: float
    total_scrap: float
    scrap_rate_percent: float | None = None


class ProductionLookupOption(BaseModel):
    id: int
    label: str
    code: str | None = None
    extra: str | None = None
