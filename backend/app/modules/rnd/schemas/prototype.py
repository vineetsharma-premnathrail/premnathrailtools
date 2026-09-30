from datetime import date, datetime
from pydantic import BaseModel


class RndPrototypeBomItemPayload(BaseModel):
    store_item_id: int | None = None
    item_code: str | None = None
    item_name: str
    quantity: float = 1
    uom: str | None = None
    unit_cost: float | None = None
    remarks: str | None = None


class RndPrototypeBomItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    store_item_id: int | None = None
    item_code: str | None = None
    item_name: str
    quantity: float
    uom: str | None = None
    unit_cost: float | None = None
    remarks: str | None = None
    line_cost: float = 0


class RndPrototypeCreate(BaseModel):
    project_id: int
    name: str
    version: str = "v1"
    description: str | None = None
    build_date: date | None = None
    bom_items: list[RndPrototypeBomItemPayload] = []


class RndPrototypeUpdate(BaseModel):
    project_id: int | None = None
    name: str | None = None
    version: str | None = None
    status: str | None = None
    description: str | None = None
    build_date: date | None = None
    findings: str | None = None
    # When sent, replaces the whole BOM (the editor always submits every line).
    bom_items: list[RndPrototypeBomItemPayload] | None = None


class RndPrototypeReleasePayload(BaseModel):
    """Release a validated prototype's BOM to Production as a draft BOM."""

    product_item_id: int  # the finished product's Store item
    base_quantity: float = 1
    remarks: str | None = None


class RndPrototypeResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    prototype_number: str
    project_id: int
    name: str
    version: str
    status: str
    description: str | None = None
    build_date: date | None = None
    findings: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    production_bom_id: int | None = None
    released_at: datetime | None = None
    released_by_id: int | None = None
    bom_items: list[RndPrototypeBomItemResponse] = []

    # Denormalized display fields, filled in by the route.
    project_number: str | None = None
    project_title: str | None = None
    bom_cost: float = 0
    experiment_count: int = 0
    document_count: int = 0
    production_bom_number: str | None = None
    production_bom_status: str | None = None
    released_by_name: str | None = None
