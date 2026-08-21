from datetime import date, datetime
from pydantic import BaseModel, Field


class P2PPurchaseOrderItemPayload(BaseModel):
    item_name: str
    make: str | None = None
    part_code: str | None = None
    unit: str | None = None
    quantity: float = 1
    unit_price: float | None = None
    tax_rate: float | None = None


class P2PPurchaseOrderItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_name: str
    make: str | None = None
    part_code: str | None = None
    unit: str | None = None
    quantity: float
    unit_price: float | None = None
    tax_rate: float | None = None
    line_total: float | None = None


class P2PPurchaseOrderCreate(BaseModel):
    p2p_request_id: int | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    po_date: date | None = None
    expected_delivery: date | None = None
    delivery_terms: str | None = None
    items: list[P2PPurchaseOrderItemPayload] = Field(default_factory=list)


class P2PPurchaseOrderUpdate(BaseModel):
    status: str | None = None
    expected_delivery: date | None = None
    delivery_terms: str | None = None


class P2PPurchaseOrderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    po_number: str
    p2p_request_id: int | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    status: str
    po_date: date
    expected_delivery: date | None = None
    delivery_terms: str | None = None
    total_value: float | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[P2PPurchaseOrderItemResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    p2p_request_number: str | None = None
    created_by_name: str | None = None
