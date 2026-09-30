from datetime import datetime
from pydantic import BaseModel, Field


class HydComponentSpecPayload(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    value: str = Field(max_length=255)


class HydComponentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str
    system_type: str = "hydraulic"
    status: str = "active"
    manufacturer: str | None = Field(None, max_length=150)
    model_number: str | None = Field(None, max_length=100)
    part_number: str | None = Field(None, max_length=100)
    store_item_id: int | None = None
    rated_pressure_bar: float | None = Field(None, ge=0)
    max_pressure_bar: float | None = Field(None, ge=0)
    flow_rate_lpm: float | None = Field(None, ge=0)
    displacement_cc: float | None = Field(None, ge=0)
    bore_mm: float | None = Field(None, ge=0)
    rod_mm: float | None = Field(None, ge=0)
    stroke_mm: float | None = Field(None, ge=0)
    port_size: str | None = Field(None, max_length=50)
    mounting: str | None = Field(None, max_length=100)
    media: str | None = Field(None, max_length=100)
    seal_material: str | None = Field(None, max_length=50)
    temp_min_c: float | None = None
    temp_max_c: float | None = None
    weight_kg: float | None = Field(None, ge=0)
    unit_cost: float = Field(0.0, ge=0)
    specifications: list[HydComponentSpecPayload] = []
    datasheet_url: str | None = Field(None, max_length=1000)
    description: str | None = None


class HydComponentUpdate(BaseModel):
    """`category` is fixed after creation — its prefix is part of the code."""
    name: str | None = Field(None, min_length=1, max_length=200)
    system_type: str | None = None
    status: str | None = None
    manufacturer: str | None = Field(None, max_length=150)
    model_number: str | None = Field(None, max_length=100)
    part_number: str | None = Field(None, max_length=100)
    store_item_id: int | None = None
    rated_pressure_bar: float | None = Field(None, ge=0)
    max_pressure_bar: float | None = Field(None, ge=0)
    flow_rate_lpm: float | None = Field(None, ge=0)
    displacement_cc: float | None = Field(None, ge=0)
    bore_mm: float | None = Field(None, ge=0)
    rod_mm: float | None = Field(None, ge=0)
    stroke_mm: float | None = Field(None, ge=0)
    port_size: str | None = Field(None, max_length=50)
    mounting: str | None = Field(None, max_length=100)
    media: str | None = Field(None, max_length=100)
    seal_material: str | None = Field(None, max_length=50)
    temp_min_c: float | None = None
    temp_max_c: float | None = None
    weight_kg: float | None = Field(None, ge=0)
    unit_cost: float | None = Field(None, ge=0)
    specifications: list[HydComponentSpecPayload] | None = None
    datasheet_url: str | None = Field(None, max_length=1000)
    description: str | None = None


class HydComponentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    category: str
    system_type: str
    status: str
    manufacturer: str | None = None
    model_number: str | None = None
    part_number: str | None = None
    store_item_id: int | None = None
    rated_pressure_bar: float | None = None
    max_pressure_bar: float | None = None
    flow_rate_lpm: float | None = None
    displacement_cc: float | None = None
    bore_mm: float | None = None
    rod_mm: float | None = None
    stroke_mm: float | None = None
    port_size: str | None = None
    mounting: str | None = None
    media: str | None = None
    seal_material: str | None = None
    temp_min_c: float | None = None
    temp_max_c: float | None = None
    weight_kg: float | None = None
    unit_cost: float
    specifications: list[HydComponentSpecPayload] = []
    datasheet_url: str | None = None
    description: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    store_item_code: str | None = None
    store_item_name: str | None = None
    bom_usage_count: int = 0
    spare_count: int = 0
