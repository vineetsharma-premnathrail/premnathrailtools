from datetime import datetime
from pydantic import BaseModel, Field


class ProductionBomItemPayload(BaseModel):
    component_item_id: int
    quantity: float = Field(gt=0)
    scrap_percent: float = Field(0.0, ge=0, lt=100)
    remarks: str | None = None


class ProductionBomItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    component_item_id: int
    quantity: float
    scrap_percent: float
    remarks: str | None = None
    sort_order: int

    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    unit_cost: float = 0.0


class ProductionBomOperationPayload(BaseModel):
    sequence: int = Field(ge=1)
    operation_name: str = Field(min_length=1, max_length=150)
    workstation_id: int | None = None
    setup_hours: float = Field(0.0, ge=0)
    run_hours_per_unit: float = Field(0.0, ge=0)
    requires_inspection: bool = False
    instructions: str | None = None


class ProductionBomOperationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    sequence: int
    operation_name: str
    workstation_id: int | None = None
    setup_hours: float
    run_hours_per_unit: float
    requires_inspection: bool
    instructions: str | None = None

    workstation_name: str | None = None


class ProductionBomCreate(BaseModel):
    product_item_id: int
    base_quantity: float = Field(1.0, gt=0)
    description: str | None = None
    remarks: str | None = None
    items: list[ProductionBomItemPayload] = []
    operations: list[ProductionBomOperationPayload] = []


class ProductionBomUpdate(BaseModel):
    """Draft-only. `items` / `operations`, when sent, replace the full list."""
    base_quantity: float | None = Field(None, gt=0)
    description: str | None = None
    remarks: str | None = None
    items: list[ProductionBomItemPayload] | None = None
    operations: list[ProductionBomOperationPayload] | None = None


class ProductionBomResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    bom_number: str
    product_item_id: int
    version: int
    base_quantity: float
    status: str
    description: str | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    activated_by_id: int | None = None
    activated_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[ProductionBomItemResponse] = []
    operations: list[ProductionBomOperationResponse] = []

    # Denormalized display fields, filled in by the route.
    product_code: str | None = None
    product_name: str | None = None
    product_uom: str | None = None
    created_by_name: str | None = None
    activated_by_name: str | None = None
    standard_material_cost: float = 0.0
    standard_labour_cost: float = 0.0
    work_order_count: int = 0
