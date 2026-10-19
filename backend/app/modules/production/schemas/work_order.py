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
    item_category: str = "stock"

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
    quality_lot_id: int | None = None
    instructions: str | None = None
    remarks: str | None = None
    control_key: str = "internal"
    confirmation: str = "optional"
    print_on_job_card: bool = True
    vendor_id: int | None = None
    external_cost: float | None = None
    job_work_issue_id: int | None = None

    workstation_name: str | None = None
    vendor_name: str | None = None
    job_work_issue_number: str | None = None
    # External step: has the processed material come back from the vendor?
    job_work_returned: bool = False
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
    # CO01 sales-order assignment (line must belong to the order).
    sales_order_id: int | None = None
    sales_order_line_id: int | None = None
    parent_work_order_id: int | None = None
    # Order Project element (vehicle / lot) — required when the sales order
    # has an Order Project; inherited from the build / parent order.
    order_project_id: int | None = None
    order_project_element_id: int | None = None


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
    sales_order_id: int | None = None
    sales_order_line_id: int | None = None
    order_project_id: int | None = None
    order_project_element_id: int | None = None


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
    # Issue only: a Store Manager taking stock held for ANOTHER Order Project
    # element must say why (store/services/project_stock.secure_issue_qty).
    project_stock_override_reason: str | None = None


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
    # Completing a "confirmation required" step without any good quantity
    # needs a reason (e.g. all units scrapped).
    no_yield_reason: str | None = None


class ProductionOperationJobWorkPayload(BaseModel):
    """Link an external step to the Store job-work challan its material went out on."""
    issue_id: int


class ProductionSubOrdersPayload(BaseModel):
    """CS11: raise dependent work orders for the make items in the order's
    BOM tree. `levels` = how deep (1 = direct sub-assemblies only)."""
    levels: int = Field(15, ge=1, le=15)
    net_free_stock: bool = False


class ProductionChangeFlagClearPayload(BaseModel):
    resolution: str = Field(min_length=3)


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
    cost_relieved: float | None = 0.0  # None = hidden by the costs switch
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
    sales_order_id: int | None = None
    sales_order_line_id: int | None = None
    sales_order_label: str | None = None
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    order_project_number: str | None = None
    order_project_element_no: str | None = None
    order_project_element_label: str | None = None
    parent_work_order_id: int | None = None
    parent_wo_number: str | None = None
    child_count: int = 0
    change_flag: str | None = None
    change_flag_ecn_id: int | None = None
    change_flag_at: datetime | None = None
    change_flag_cleared_at: datetime | None = None
    change_flag_resolution: str | None = None


class ProductionDependentOrder(BaseModel):
    id: int
    wo_number: str
    product_item_id: int
    product_code: str | None = None
    product_name: str | None = None
    quantity_planned: float
    status: str
    level: int
    parent_work_order_id: int | None = None


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
    # Valued cost of the movement for the order: the issue/return rate
    # charged to it, or the FG receipt value at actual cost.
    order_unit_cost: float | None = None
    order_value: float | None = None


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
    # Costing-sheet overhead (Finance › Controlling); included in the totals.
    estimated_overhead_cost: float = 0.0
    actual_overhead_cost: float = 0.0
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
    cost_relieved: float = 0.0
    open_cost: float = 0.0
    materials: list[ProductionCostLine] = []
