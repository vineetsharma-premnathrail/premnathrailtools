from datetime import datetime
from pydantic import BaseModel, Field


class HydBomItemPayload(BaseModel):
    component_id: int
    tag_number: str | None = Field(None, max_length=30)
    quantity: float = Field(gt=0)
    uom: str = Field("NOS", min_length=1, max_length=20)
    remarks: str | None = None


class HydBomItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    component_id: int
    tag_number: str | None = None
    quantity: float
    uom: str
    remarks: str | None = None
    sort_order: int

    component_code: str | None = None
    component_name: str | None = None
    component_category: str | None = None
    manufacturer: str | None = None
    model_number: str | None = None
    unit_cost: float = 0.0
    line_cost: float = 0.0


class HydBomCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    system_type: str = "hydraulic"
    system_id: int | None = None
    circuit_id: int | None = None
    remarks: str | None = None
    items: list[HydBomItemPayload] = []


class HydBomUpdate(BaseModel):
    """Draft-only. `items`, when sent, replaces the full list."""
    title: str | None = Field(None, min_length=1, max_length=255)
    system_id: int | None = None
    circuit_id: int | None = None
    remarks: str | None = None
    items: list[HydBomItemPayload] | None = None


class HydBomResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    bom_number: str
    revision: str
    title: str
    system_type: str
    system_id: int | None = None
    circuit_id: int | None = None
    status: str
    remarks: str | None = None
    created_by_id: int | None = None
    released_by_id: int | None = None
    released_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[HydBomItemResponse] = []

    # Denormalized display fields, filled in by the route.
    system_number: str | None = None
    system_name: str | None = None
    circuit_number: str | None = None
    circuit_revision: str | None = None
    created_by_name: str | None = None
    released_by_name: str | None = None
    line_count: int = 0
    total_cost: float = 0.0
