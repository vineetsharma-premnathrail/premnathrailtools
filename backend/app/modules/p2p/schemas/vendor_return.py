from datetime import date, datetime
from pydantic import BaseModel, Field


class P2PVendorReturnItemPayload(BaseModel):
    grn_item_id: int
    source: str  # accepted | rejected
    quantity: float
    # Serialised line: the units going back (optional when only that many are left).
    serials: list[str] = []


class P2PVendorReturnItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    grn_item_id: int
    store_item_id: int | None = None
    item_name: str
    unit: str | None = None
    source: str
    quantity: float
    unit_rate: float | None = None
    tax_rate: float | None = None
    value: float | None = None


class P2PVendorReturnCreate(BaseModel):
    goods_receipt_id: int
    return_date: date | None = None
    reason: str
    remarks: str | None = None
    vehicle_number: str | None = None
    items: list[P2PVendorReturnItemPayload] = Field(default_factory=list)


class P2PVendorReturnResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rtv_number: str
    purchase_order_id: int
    goods_receipt_id: int
    vendor_name: str | None = None
    store_location_id: int | None = None
    return_date: date
    reason: str
    remarks: str | None = None
    vehicle_number: str | None = None
    ncr_id: int | None = None
    stock_posted: bool = True
    debit_note_id: int | None = None
    debit_note_message: str | None = None
    total_value: float | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    items: list[P2PVendorReturnItemResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    reason_label: str | None = None
    grn_number: str | None = None
    po_number: str | None = None
    store_location_name: str | None = None
    debit_note_number: str | None = None
    debit_note_status: str | None = None
    created_by_name: str | None = None
