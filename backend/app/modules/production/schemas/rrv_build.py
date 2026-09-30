from datetime import date, datetime
from pydantic import BaseModel, Field


class ProductionRrvBuildStageResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    stage_key: str
    sequence: int
    status: str
    assignee_id: int | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    completed_by_id: int | None = None
    remarks: str | None = None

    label: str = ""
    phase: str = ""
    na_allowed: bool = False
    assignee_name: str | None = None
    completed_by_name: str | None = None
    # What still blocks completing it — empty means it can be completed now.
    gate_problems: list[str] = []
    is_overdue: bool = False


class ProductionRrvTestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    build_id: int
    test_type: str
    test_date: date
    result: str
    expected: str | None = None
    observed: str | None = None
    remarks: str | None = None
    tested_by_id: int | None = None
    witnessed_by: str | None = None
    retest_of_id: int | None = None
    created_at: datetime | None = None

    test_label: str = ""
    tested_by_name: str | None = None
    rework_number: str | None = None


class ProductionReworkOrderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rework_number: str
    build_id: int
    source: str
    source_test_id: int | None = None
    quality_inspection_id: int | None = None
    work_order_id: int | None = None
    quality_ncr_id: int | None = None
    title: str
    defect_description: str | None = None
    root_cause: str | None = None
    corrective_action: str | None = None
    assigned_to_id: int | None = None
    due_date: date | None = None
    status: str
    hours_spent: float = 0.0
    started_at: datetime | None = None
    done_at: datetime | None = None
    done_by_id: int | None = None
    verified_at: datetime | None = None
    verified_by_id: int | None = None
    verification_remarks: str | None = None
    cancel_reason: str | None = None
    created_at: datetime | None = None

    build_number: str | None = None
    rrv_model: str | None = None
    assigned_to_name: str | None = None
    done_by_name: str | None = None
    verified_by_name: str | None = None
    source_label: str | None = None
    inspection_number: str | None = None
    wo_number: str | None = None
    is_overdue: bool = False


class ProductionRrvWorkOrderSummary(BaseModel):
    id: int
    wo_number: str
    build_role: str | None = None
    status: str
    product_code: str | None = None
    product_name: str | None = None
    quantity_planned: float
    quantity_completed: float
    operations_total: int = 0
    operations_done: int = 0
    outstanding_lines: int = 0
    planned_end_date: date | None = None


class ProductionRrvConsumptionRow(BaseModel):
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    required_qty: float = 0.0
    issued_qty: float = 0.0
    returned_qty: float = 0.0
    consumed_qty: float = 0.0
    outstanding_qty: float = 0.0
    unit_cost: float = 0.0
    consumed_value: float = 0.0
    work_orders: list[str] = []


class ProductionRrvConsumption(BaseModel):
    rows: list[ProductionRrvConsumptionRow] = []
    total_consumed_value: float = 0.0
    total_required_lines: int = 0
    lines_fully_issued: int = 0


class ProductionRrvIntegration(BaseModel):
    """Status of the machine's Electrical job(s) and Hydraulic system(s) —
    read from those modules, never duplicated here."""
    electrical_jobs: list[dict] = []
    hydraulic_systems: list[dict] = []


class ProductionRrvEventResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    action: str
    comment: str | None = None
    actor_id: int | None = None
    created_at: datetime | None = None
    actor_name: str | None = None


class ProductionRrvBuildCreate(BaseModel):
    rrv_model: str = Field(min_length=2, max_length=200)
    customer_name: str | None = Field(None, max_length=255)
    customer_po_number: str | None = Field(None, max_length=100)
    customer_po_date: date | None = None
    order_reference: str | None = Field(None, max_length=150)
    erp_project_id: int | None = None
    vehicle_serial_number: str | None = Field(None, max_length=100)
    chassis_number: str | None = Field(None, max_length=100)
    engine_number: str | None = Field(None, max_length=100)
    year_of_manufacture: str | None = Field(None, max_length=10)
    branch_id: int | None = None
    build_manager_id: int | None = None
    priority: str = "normal"
    planned_start_date: date | None = None
    target_completion_date: date | None = None
    target_handover_date: date | None = None
    required_tests: list[str] | None = None
    warranty_months: int = Field(12, ge=0, le=120)
    remarks: str | None = None


class ProductionRrvBuildUpdate(BaseModel):
    """Partial update; only fields sent are applied. Identity and handover
    details freeze once the build is handed over."""
    rrv_model: str | None = Field(None, min_length=2, max_length=200)
    customer_name: str | None = Field(None, max_length=255)
    customer_po_number: str | None = Field(None, max_length=100)
    customer_po_date: date | None = None
    order_reference: str | None = Field(None, max_length=150)
    erp_project_id: int | None = None
    vehicle_serial_number: str | None = Field(None, max_length=100)
    chassis_number: str | None = Field(None, max_length=100)
    engine_number: str | None = Field(None, max_length=100)
    year_of_manufacture: str | None = Field(None, max_length=10)
    branch_id: int | None = None
    build_manager_id: int | None = None
    priority: str | None = None
    planned_start_date: date | None = None
    target_completion_date: date | None = None
    target_handover_date: date | None = None
    required_tests: list[str] | None = None
    warranty_months: int | None = Field(None, ge=0, le=120)
    remarks: str | None = None
    handover_date: date | None = None
    commissioning_date: date | None = None
    handed_over_to_name: str | None = Field(None, max_length=200)
    handed_over_to_organization: str | None = Field(None, max_length=255)
    handover_location: str | None = Field(None, max_length=255)
    customer_acceptance_ref: str | None = Field(None, max_length=150)
    handover_remarks: str | None = None


class ProductionRrvReasonPayload(BaseModel):
    reason: str = Field(min_length=3, max_length=4000)


class ProductionRrvLinkWorkOrderPayload(BaseModel):
    build_role: str = "sub_assembly"


class ProductionRrvStageUpdatePayload(BaseModel):
    assignee_id: int | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    remarks: str | None = Field(None, max_length=4000)


class ProductionRrvStageCompletePayload(BaseModel):
    remarks: str | None = Field(None, max_length=4000)


class ProductionRrvTestCreate(BaseModel):
    test_type: str
    test_date: date
    result: str
    expected: str | None = Field(None, max_length=4000)
    observed: str | None = Field(None, max_length=4000)
    remarks: str | None = Field(None, max_length=4000)
    witnessed_by: str | None = Field(None, max_length=255)
    retest_of_id: int | None = None
    # Who does the rework if this fails (the auto-raised rework order).
    rework_assignee_id: int | None = None


class ProductionReworkOrderCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    defect_description: str | None = Field(None, max_length=4000)
    assigned_to_id: int | None = None
    due_date: date | None = None
    quality_ncr_id: int | None = None


class ProductionReworkDonePayload(BaseModel):
    corrective_action: str = Field(min_length=3, max_length=4000)
    root_cause: str | None = Field(None, max_length=4000)
    hours_spent: float = Field(0.0, ge=0, le=10000)


class ProductionReworkVerifyPayload(BaseModel):
    remarks: str | None = Field(None, max_length=4000)


class ProductionRrvBuildResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    build_number: str
    rrv_model: str
    customer_name: str | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    order_reference: str | None = None
    erp_project_id: int | None = None
    vehicle_serial_number: str | None = None
    chassis_number: str | None = None
    engine_number: str | None = None
    year_of_manufacture: str | None = None
    branch_id: int | None = None
    build_manager_id: int | None = None
    priority: str
    status: str
    planned_start_date: date | None = None
    target_completion_date: date | None = None
    target_handover_date: date | None = None
    actual_start_at: datetime | None = None
    completed_at: datetime | None = None
    completed_by_id: int | None = None
    required_tests: list[str] = []
    final_inspection_id: int | None = None
    handover_date: date | None = None
    commissioning_date: date | None = None
    handed_over_to_name: str | None = None
    handed_over_to_organization: str | None = None
    handover_location: str | None = None
    customer_acceptance_ref: str | None = None
    warranty_months: int = 12
    handover_remarks: str | None = None
    handed_over_at: datetime | None = None
    handed_over_by_id: int | None = None
    hold_reason: str | None = None
    cancel_reason: str | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    machine_label: str | None = None
    branch_name: str | None = None
    build_manager_name: str | None = None
    completed_by_name: str | None = None
    handed_over_by_name: str | None = None
    stages_done: int = 0
    stages_total: int = 0
    current_stage_key: str | None = None
    current_stage_label: str | None = None
    open_rework_count: int = 0
    work_order_count: int = 0
    is_overdue: bool = False


class ProductionRrvBuildDetail(ProductionRrvBuildResponse):
    stages: list[ProductionRrvBuildStageResponse] = []
    work_orders: list[ProductionRrvWorkOrderSummary] = []
    tests: list[ProductionRrvTestResponse] = []
    test_status: dict[str, str] = {}
    rework_orders: list[ProductionReworkOrderResponse] = []
    events: list[ProductionRrvEventResponse] = []
    integration: ProductionRrvIntegration = ProductionRrvIntegration()
    final_inspection_number: str | None = None
    final_inspection_status: str | None = None
    allowed_actions: list[str] = []
