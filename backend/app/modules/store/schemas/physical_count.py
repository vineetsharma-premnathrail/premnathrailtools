from datetime import date, datetime
from pydantic import BaseModel, Field


class StorePhysicalCountItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    # Hidden (None) during a blind count for users who can't approve adjustments.
    book_quantity: float | None = None
    first_counted_quantity: float | None = None
    counted_quantity: float | None = None
    difference: float | None = None
    count_rounds: int = 0
    remarks: str | None = None

    # Denormalized display fields, filled in by the route.
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    counted_by_name: str | None = None


class StorePhysicalCountCreate(BaseModel):
    location_id: int
    # Narrow the count: one category, or chosen items. Neither = every item
    # with stock at the store.
    category: str | None = None
    item_ids: list[int] = Field(default_factory=list)
    # Bin-wise count (WM): count only this bin; book stock is the bin's stock.
    bin_id: int | None = None
    blind: bool = True
    remarks: str | None = None


class StorePhysicalCountLine(BaseModel):
    line_id: int
    counted_quantity: float
    remarks: str | None = None


class StorePhysicalCountCountsPayload(BaseModel):
    lines: list[StorePhysicalCountLine] = Field(default_factory=list)


class StorePhysicalCountAddItemPayload(BaseModel):
    item_id: int


class StorePhysicalCountSubmitPayload(BaseModel):
    approver_id: int
    reason: str | None = None


class StorePhysicalCountCancelPayload(BaseModel):
    reason: str


class StorePhysicalCountResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    count_number: str
    location_id: int
    count_date: date
    scope: str | None = None
    bin_id: int | None = None
    bin_code: str | None = None
    blind: bool = True
    status: str
    remarks: str | None = None
    adjustment_id: int | None = None
    created_by_id: int | None = None
    submitted_at: datetime | None = None
    closed_at: datetime | None = None
    cancel_reason: str | None = None
    created_at: datetime | None = None
    items: list[StorePhysicalCountItemResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route.
    location_name: str | None = None
    created_by_name: str | None = None
    adjustment_number: str | None = None
    adjustment_status: str | None = None
    lines_total: int = 0
    lines_counted: int = 0
    lines_with_difference: int | None = None
    book_hidden: bool = False
