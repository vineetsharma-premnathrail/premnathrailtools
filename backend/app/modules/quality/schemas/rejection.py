from datetime import date, datetime
from pydantic import BaseModel


class QualityRejectionCreate(BaseModel):
    ncr_id: int | None = None
    inspection_id: int | None = None
    item_name: str
    item_code: str | None = None
    quantity: float | None = None
    disposition: str
    vendor_id: int | None = None
    vendor_name: str | None = None
    rejection_date: date
    remarks: str | None = None


class QualityRejectionUpdate(BaseModel):
    ncr_id: int | None = None
    inspection_id: int | None = None
    item_name: str | None = None
    item_code: str | None = None
    quantity: float | None = None
    disposition: str | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    rejection_date: date | None = None
    remarks: str | None = None
    status: str | None = None


class QualityRejectionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rejection_number: str
    ncr_id: int | None = None
    inspection_id: int | None = None
    item_name: str
    item_code: str | None = None
    quantity: float | None = None
    disposition: str
    status: str
    vendor_id: int | None = None
    vendor_name: str | None = None
    rejection_date: date
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display field, filled in by the route.
    ncr_number: str | None = None
