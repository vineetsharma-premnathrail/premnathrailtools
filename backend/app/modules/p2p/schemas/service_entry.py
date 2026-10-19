from datetime import date, datetime
from pydantic import BaseModel, Field


class P2PServiceEntryCreate(BaseModel):
    po_item_id: int
    quantity: float
    service_date: date | None = None
    period_from: date | None = None
    period_to: date | None = None
    description: str | None = None


class P2PServiceEntryCancelPayload(BaseModel):
    reason: str


class P2PServiceEntryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    ses_number: str
    purchase_order_id: int
    po_item_id: int
    period_from: date | None = None
    period_to: date | None = None
    service_date: date
    quantity: float
    description: str | None = None
    status: str
    created_by_id: int | None = None
    accepted_by_id: int | None = None
    accepted_at: datetime | None = None
    cancelled_by_id: int | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    created_at: datetime | None = None

    # Denormalized display fields.
    item_name: str | None = None
    unit: str | None = None
    created_by_name: str | None = None
    accepted_by_name: str | None = None


class P2PServiceLineSummary(BaseModel):
    po_item_id: int
    item_name: str
    item_code: str | None = None
    unit: str | None = None
    ordered_quantity: float
    accepted_quantity: float
    pending_entry_quantity: float
    open_quantity: float


class P2PServiceEntriesOverview(BaseModel):
    purchase_order_id: int
    po_number: str
    service_lines: list[P2PServiceLineSummary] = Field(default_factory=list)
    entries: list[P2PServiceEntryResponse] = Field(default_factory=list)
