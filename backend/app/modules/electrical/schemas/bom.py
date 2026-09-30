from datetime import datetime
from pydantic import BaseModel, Field


class ElectricalBomItemCreate(BaseModel):
    category: str = "other"
    description: str = Field(min_length=1, max_length=255)
    store_item_id: int | None = None
    make: str | None = Field(None, max_length=150)
    part_number: str | None = Field(None, max_length=150)
    rating: str | None = Field(None, max_length=150)
    specification: str | None = None
    quantity: float = Field(1.0, gt=0)
    uom: str = Field("NOS", min_length=1, max_length=20)
    estimated_unit_cost: float | None = Field(None, ge=0)
    panel_id: int | None = None
    selection_status: str = "proposed"
    procurement_status: str = "required"
    remarks: str | None = None


class ElectricalBomItemUpdate(BaseModel):
    category: str | None = None
    description: str | None = Field(None, min_length=1, max_length=255)
    store_item_id: int | None = None
    make: str | None = Field(None, max_length=150)
    part_number: str | None = Field(None, max_length=150)
    rating: str | None = Field(None, max_length=150)
    specification: str | None = None
    quantity: float | None = Field(None, gt=0)
    uom: str | None = Field(None, min_length=1, max_length=20)
    estimated_unit_cost: float | None = Field(None, ge=0)
    panel_id: int | None = None
    selection_status: str | None = None
    procurement_status: str | None = None
    remarks: str | None = None


class ElectricalBomItemLinkPrPayload(BaseModel):
    p2p_number: str = Field(min_length=1, max_length=50)


class ElectricalBomItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    job_id: int
    line_no: int
    category: str
    description: str
    store_item_id: int | None = None
    make: str | None = None
    part_number: str | None = None
    rating: str | None = None
    specification: str | None = None
    quantity: float
    uom: str
    estimated_unit_cost: float | None = None
    panel_id: int | None = None
    selection_status: str
    procurement_status: str
    p2p_request_id: int | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    store_item_code: str | None = None
    panel_tag: str | None = None
    p2p_number: str | None = None
    p2p_status: str | None = None
    job_number: str | None = None
    job_title: str | None = None
