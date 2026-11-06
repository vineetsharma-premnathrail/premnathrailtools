from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


class PrePoReceiptItemCreate(BaseModel):
    store_item_id: int
    quantity: float = Field(gt=0, allow_inf_nan=False)
    remarks: str | None = Field(default=None, max_length=2000)
    # Optional rate per unit from the vendor's quote / bill; values the stock until the PO's own rate arrives.
    unit_rate: float | None = Field(default=None, allow_inf_nan=False)

    @field_validator("unit_rate")
    @classmethod
    def _rate_positive(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("Rate must be more than 0 - leave it empty if you don't know it; the stock is then valued at the item's average "
                             "rate until the PO's rate comes.")
        return v


class PrePoReceiptCreate(BaseModel):
    vendor_id: int
    received_date: date
    store_location_id: int | None = None
    delivery_challan_number: str | None = Field(default=None, max_length=100)
    vendor_invoice_number: str | None = Field(default=None, max_length=100)
    vendor_invoice_date: date | None = None
    remarks: str | None = Field(default=None, max_length=2000)
    items: list[PrePoReceiptItemCreate] = Field(min_length=1)


class PrePoReceiptCancel(BaseModel):
    reason: str = Field(max_length=2000)

    @field_validator("reason")
    @classmethod
    def _reason_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Give the reason for cancelling this receipt (for example: goods returned to the vendor).")
        return v


class PrePoReceiptItemResponse(BaseModel):
    id: int
    store_item_id: int
    item_code: str | None = None
    item_name: str
    unit: str | None = None
    quantity: float
    remarks: str | None = None
    unit_rate: float | None = None
    # 'free' = in Free stock, 'quality' = in Quality stock under inspection_lot_*; None = receipt made before stock was posted.
    receipt_posting: str | None = None
    inspection_lot_id: int | None = None
    inspection_lot_number: str | None = None
    settled_qty: float = 0


class PrePoReceiptAttachmentResponse(BaseModel):
    id: int
    doc_type: str
    filename: str
    content_type: str | None = None
    size: int | None = None
    uploaded_by_id: int | None = None
    uploaded_by_name: str | None = None
    created_at: datetime | None = None


class PrePoReceiptResponse(BaseModel):
    id: int
    receipt_number: str
    vendor_id: int | None = None
    vendor_name: str
    received_date: date
    store_location_id: int | None = None
    store_location_name: str | None = None
    delivery_challan_number: str | None = None
    vendor_invoice_number: str | None = None
    vendor_invoice_date: date | None = None
    remarks: str | None = None
    status: str
    p2p_request_id: int | None = None
    p2p_number: str | None = None
    purchase_order_id: int | None = None
    po_number: str | None = None
    po_status: str | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    cancel_reason: str | None = None
    stock_posted: bool = False
    items: list[PrePoReceiptItemResponse] = Field(default_factory=list)
    attachments: list[PrePoReceiptAttachmentResponse] = Field(default_factory=list)
