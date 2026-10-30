from datetime import date, datetime

from pydantic import BaseModel, Field


class ProductionMrpRunCreate(BaseModel):
    # The plant (branch) to plan; None = company-wide (all plants together).
    branch_id: int | None = None
    # Plant runs: also plan documents / stock with no plant. Default: only
    # when the company has a single active plant.
    include_unassigned: bool | None = None
    planning_horizon_days: int | None = Field(None, ge=7, le=1825)
    include_draft_work_orders: bool | None = None


class ProductionPlannedOrderCreate(BaseModel):
    """MD11 — a manual planned order (always firmed)."""
    item_id: int
    quantity: float = Field(gt=0)
    finish_date: date
    start_date: date | None = None
    branch_id: int | None = None
    procurement: str | None = None  # make | buy; default from whether the item has an active BOM
    remarks: str | None = None


class ProductionPlannedOrderUpdate(BaseModel):
    """MD12 — changing quantity or dates firms the order."""
    quantity: float | None = Field(None, gt=0)
    start_date: date | None = None
    finish_date: date | None = None
    firmed: bool | None = None
    remarks: str | None = None


class ProductionPlannedOrderConvertWoPayload(BaseModel):
    source_location_id: int | None = None
    target_location_id: int | None = None
    supervisor_id: int | None = None
    priority: str = "standard"


class ProductionPlannedOrderConvertPrPayload(BaseModel):
    planned_order_ids: list[int] = Field(min_length=1)
    # One PR per category. Empty = suggested from each item's Item Master category.
    category_code: str | None = None
    priority: str = "standard"
    save_as_draft: bool = False
    remarks: str | None = None


class ProductionPlannedOrderBulkPayload(BaseModel):
    planned_order_ids: list[int] = Field(min_length=1)


class ProductionPlannedOrderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    order_number: str
    run_id: int | None = None
    source: str
    branch_id: int | None = None
    item_id: int
    procurement: str
    bom_id: int | None = None
    quantity: float
    start_date: date
    finish_date: date
    firmed: bool
    status: str
    demand_type: str | None = None
    demand_ref_id: int | None = None
    demand_label: str | None = None
    parent_planned_order_id: int | None = None
    sales_order_id: int | None = None
    sales_schedule_id: int | None = None
    rrv_build_id: int | None = None
    erp_project_id: int | None = None
    work_order_id: int | None = None
    # project element of the pegged demand (Purchase reads it).
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    converted_type: str | None = None
    converted_ref_id: int | None = None
    converted_number: str | None = None
    converted_at: datetime | None = None
    remarks: str | None = None
    created_at: datetime | None = None

    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    branch_name: str | None = None
    bom_number: str | None = None
    run_number: str | None = None
    parent_order_number: str | None = None
    start_in_past: bool = False
    suggested_category_code: str | None = None
    order_project_label: str | None = None


class ProductionMrpRunResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    run_number: str
    branch_id: int | None = None
    include_unassigned: bool
    status: str
    parameters: dict = {}
    started_at: datetime | None = None
    finished_at: datetime | None = None
    run_by_id: int | None = None
    items_planned: int
    planned_orders_created: int
    make_orders: int
    buy_orders: int
    planned_orders_deleted: int
    exceptions_count: int
    log: list = []
    error: str | None = None

    branch_name: str | None = None
    run_by_name: str | None = None


class ProductionMrpRunDetail(ProductionMrpRunResponse):
    item_results: list = []


class ProductionMrpExceptionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    run_id: int
    branch_id: int | None = None
    item_id: int | None = None
    code: str
    message: str
    element_type: str | None = None
    element_ref: str | None = None
    element_date: date | None = None
    suggested_date: date | None = None
    quantity: float | None = None

    label: str | None = None
    item_code: str | None = None
    item_name: str | None = None
    run_number: str | None = None
