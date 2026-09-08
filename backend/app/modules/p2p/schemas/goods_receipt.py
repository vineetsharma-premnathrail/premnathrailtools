from datetime import date, datetime
from pydantic import BaseModel, Field


class P2PGoodsReceiptItemPayload(BaseModel):
    po_item_id: int
    received_quantity: float


class P2PGoodsReceiptItemInspectPayload(BaseModel):
    item_id: int
    accepted_quantity: float
    rejected_quantity: float = 0
    quality_status: str
    rejection_reason: str | None = None
    remarks: str | None = None


class P2PGoodsReceiptItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    po_item_id: int
    item_name: str
    unit: str | None = None
    ordered_quantity: float
    received_quantity: float
    accepted_quantity: float | None = None
    rejected_quantity: float | None = None
    quality_status: str
    rejection_reason: str | None = None
    remarks: str | None = None


class P2PGoodsReceiptCreate(BaseModel):
    purchase_order_id: int
    store_location_id: int | None = None
    received_date: date | None = None
    remarks: str | None = None
    items: list[P2PGoodsReceiptItemPayload] = Field(default_factory=list)


class P2PGoodsReceiptInspectPayload(BaseModel):
    items: list[P2PGoodsReceiptItemInspectPayload] = Field(default_factory=list)


class P2PGoodsReceiptResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    grn_number: str
    purchase_order_id: int
    store_location_id: int | None = None
    status: str
    received_date: date
    received_by_id: int | None = None
    remarks: str | None = None
    inspected_by_id: int | None = None
    inspected_at: datetime | None = None
    created_at: datetime | None = None
    items: list[P2PGoodsReceiptItemResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    po_number: str | None = None
    p2p_request_id: int | None = None
    p2p_number: str | None = None
    vendor_name: str | None = None
    store_location_name: str | None = None
    received_by_name: str | None = None
    inspected_by_name: str | None = None
