from datetime import date, datetime

from pydantic import BaseModel


class SalesDeliveryConfirmPayload(BaseModel):
    """Mark delivered (POD) — `quantity` only for a partly delivered spares lot."""
    delivered_on: date
    reference: str
    quantity: float | None = None
    remarks: str | None = None


class SalesCommissioningConfirmPayload(BaseModel):
    commissioned_on: date
    reference: str
    remarks: str | None = None


class SalesDeliveryReversePayload(BaseModel):
    reason: str


class SalesMilestoneDuePayload(BaseModel):
    """Sales "Mark due" for a drawing-approval / inspection / other milestone."""
    on: date
    reference: str | None = None


class SalesDeliveryEventResponse(BaseModel):
    id: int
    so_id: int
    schedule_id: int
    so_line_id: int
    event: str
    quantity: float
    event_date: date
    reference: str | None = None
    remarks: str | None = None
    source: str
    material_issue_id: int | None = None
    rrv_build_id: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    reversed_at: datetime | None = None
    reversed_by_id: int | None = None
    reverse_reason: str | None = None

    # display
    row_label: str | None = None
    material_issue_number: str | None = None
    created_by_name: str | None = None
    reversed_by_name: str | None = None

    model_config = {"from_attributes": True}
