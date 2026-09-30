from datetime import datetime
from pydantic import BaseModel, Field


class HydSparePartCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = "other"
    system_type: str = "hydraulic"
    status: str = "active"
    criticality: str = "essential"
    component_id: int | None = None
    store_item_id: int | None = None
    manufacturer: str | None = Field(None, max_length=150)
    part_number: str | None = Field(None, max_length=100)
    # Blank = the linked Store item's unit, else NOS.
    uom: str | None = Field(None, max_length=20)
    unit_cost: float = Field(0.0, ge=0)
    min_stock_qty: float = Field(0.0, ge=0)
    reorder_qty: float = Field(0.0, ge=0)
    lead_time_days: int | None = Field(None, ge=0)
    shelf_life_months: int | None = Field(None, ge=0)
    interchangeable_with: str | None = Field(None, max_length=255)
    storage_notes: str | None = None
    remarks: str | None = None


class HydSparePartUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    category: str | None = None
    system_type: str | None = None
    status: str | None = None
    criticality: str | None = None
    component_id: int | None = None
    store_item_id: int | None = None
    manufacturer: str | None = Field(None, max_length=150)
    part_number: str | None = Field(None, max_length=100)
    uom: str | None = Field(None, min_length=1, max_length=20)
    unit_cost: float | None = Field(None, ge=0)
    min_stock_qty: float | None = Field(None, ge=0)
    reorder_qty: float | None = Field(None, ge=0)
    lead_time_days: int | None = Field(None, ge=0)
    shelf_life_months: int | None = Field(None, ge=0)
    interchangeable_with: str | None = Field(None, max_length=255)
    storage_notes: str | None = None
    remarks: str | None = None


class HydSparePartSystemUsage(BaseModel):
    system_id: int
    system_number: str
    system_name: str
    quantity: float


class HydSparePartResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    part_code: str
    name: str
    category: str
    system_type: str
    status: str
    criticality: str
    component_id: int | None = None
    store_item_id: int | None = None
    manufacturer: str | None = None
    part_number: str | None = None
    uom: str
    unit_cost: float
    min_stock_qty: float
    reorder_qty: float
    lead_time_days: int | None = None
    shelf_life_months: int | None = None
    interchangeable_with: str | None = None
    storage_notes: str | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    component_code: str | None = None
    component_name: str | None = None
    store_item_code: str | None = None
    store_item_name: str | None = None
    # From the Store ledger; None when the spare isn't linked to a Store item.
    on_hand_qty: float | None = None
    available_qty: float | None = None
    # ok | low | out | not_linked
    stock_status: str = "not_linked"
    used_last_12m: float = 0.0
    used_in_systems: list[HydSparePartSystemUsage] = []
