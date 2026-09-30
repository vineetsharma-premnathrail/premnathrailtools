from datetime import date, datetime
from pydantic import BaseModel, Field


class ProductionWorkOrderMaterialResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    required_qty: float
    issued_qty: float
    returned_qty: float
    remarks: str | None = None

    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    outstanding_qty: float = 0.0
    # Held for this line by its Store reservation at the source location.
    reserved_qty: float = 0.0
    # Free stock (on hand − all reservations) at the source location, on top
    # of what this line already holds.
    available_qty: float = 0.0


class ProductionWorkOrderOperationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    sequence: int
    operation_name: str
    workstation_id: int | None = None
    planned_hours: float
    requires_inspection: bool
    status: str
    qty_good: float
    qty_scrap: float
    started_at: datetime | None = None
    completed_at: datetime | None = None
    quality_inspection_id: int | None = None
    instructions: str | None = None
    remarks: str | None = None

    workstation_name: str | None = None
    actual_hours: float = 0.0
    inspection_number: str | None = None
    inspection_status: str | None = None


class ProductionWorkOrderCreate(BaseModel):
    bom_id: int
    quantity_planned: float = Field(gt=0)
    erp_project_id: int | None = None
    branch_id: int | None = None
    priority: str = "normal"
    source_location_id: int | None = None
    target_location_id: int | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    supervisor_id: int | None = None
    remarks: str | None = None
    # Optional RRV build this order is part of (routes/rrv_builds.py).
    rrv_build_id: int | None = None
    build_role: str | None = None


class ProductionWorkOrderUpdate(BaseModel):
    """quantity_planned can only change while the order is a draft (it
    re-explodes the BOM); the rest can change until the order is completed."""
    quantity_planned: float | None = Field(None, gt=0)
    erp_project_id: int | None = None
    branch_id: int | None = None
    priority: str | None = None
    source_location_id: int | None = None
    target_location_id: int | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    supervisor_id: int | None = None
    remarks: str | None = None


class ProductionMaterialLinePayload(BaseModel):
    item_id: int
    quantity: float = Field(gt=0)
    batch_number: str | None = None


class ProductionWorkOrderIssuePayload(BaseModel):
    """Issue (or return) components. location_id defaults to the work
    order's source location."""
    location_id: int | None = None
    lines: list[ProductionMaterialLinePayload] = Field(min_length=1)
    remarks: str | None = None


class ProductionWorkOrderReceivePayload(BaseModel):
    """Receive finished goods into Store. location_id defaults to the work
    order's target location."""
    quantity: float = Field(gt=0)
    location_id: int | None = None
    batch_number: str | None = None
    remarks: str | None = None


class ProductionWorkOrderCancelPayload(BaseModel):
    reason: str = Field(min_length=1)


class ProductionOperationCompletePayload(BaseModel):
    remarks: str | None = None


class ProductionWorkOrderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    wo_number: str
    product_item_id: int
    bom_id: int
    erp_project_id: int | None = None
    branch_id: int | None = None
    quantity_planned: float
    quantity_completed: float
    quantity_scrapped: float
    priority: str
    status: str
    source_location_id: int | None = None
    target_location_id: int | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    actual_start_at: datetime | None = None
    actual_end_at: datetime | None = None
    closed_at: datetime | None = None
    supervisor_id: int | None = None
    created_by_id: int | None = None
    cancel_reason: str | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    materials: list[ProductionWorkOrderMaterialResponse] = []
    operations: list[ProductionWorkOrderOperationResponse] = []

    # Denormalized display fields, filled in by the route.
    product_code: str | None = None
    product_name: str | None = None
    product_uom: str | None = None
    bom_number: str | None = None
    bom_version: int | None = None
    rrv_build_id: int | None = None
    build_role: str | None = None
    rrv_build_number: str | None = None
    project_label: str | None = None
    branch_name: str | None = None
    source_location_name: str | None = None
    target_location_name: str | None = None
    supervisor_name: str | None = None
    created_by_name: str | None = None
    progress_percent: float = 0.0
    is_overdue: bool = False
    shortage_count: int = 0


class ProductionStockMovementResponse(BaseModel):
    """A Store ledger row posted by this work order."""
    id: int
    transaction_type: str
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    location_name: str | None = None
    quantity: float
    batch_number: str | None = None
    transaction_date: date
    remarks: str | None = None
    created_by_name: str | None = None


class ProductionCostLine(BaseModel):
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    unit_cost: float
    required_qty: float
    consumed_qty: float
    estimated_cost: float
    actual_cost: float


class ProductionWorkOrderCostingResponse(BaseModel):
    work_order_id: int
    estimated_material_cost: float
    estimated_labour_cost: float
    estimated_total_cost: float
    actual_material_cost: float
    actual_labour_cost: float
    actual_total_cost: float
    planned_hours: float
    actual_hours: float
    variance: float
    variance_percent: float | None = None
    cost_per_unit: float | None = None
    materials: list[ProductionCostLine] = []
