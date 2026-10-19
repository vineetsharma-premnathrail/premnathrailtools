from datetime import date, datetime
from pydantic import BaseModel, Field


class InventoryValuationCreate(BaseModel):
    accounting_period: str
    notes: str | None = None


class InventoryValuationLineUpdate(BaseModel):
    quantity: float | None = None
    rate: float | None = None


class InventoryValuationCancelPayload(BaseModel):
    reason: str


class InventoryValuationLineResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    store_item_id: int | None = None
    item_code: str | None = None
    item_name: str
    category: str | None = None
    uom: str | None = None
    quantity: float
    rate: float
    value: float
    rate_source: str
    line_kind: str = "stock"
    work_order_id: int | None = None


class InventoryValuationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    accounting_period: str
    valuation_date: date
    total_value: float
    status: str
    notes: str | None = None
    journal_entry_id: int | None = None
    created_by_id: int | None = None
    posted_by_id: int | None = None
    created_at: datetime | None = None
    lines: list[InventoryValuationLineResponse] = Field(default_factory=list)
