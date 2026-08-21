from datetime import datetime
from pydantic import BaseModel


class StockInPayload(BaseModel):
    stock_item_id: int
    location_id: int
    quantity: float
    remarks: str | None = None


class StockIssuePayload(BaseModel):
    stock_item_id: int
    location_id: int
    quantity: float
    reference_type: str | None = None
    reference_id: int | None = None
    remarks: str | None = None
    allow_negative: bool = True


class StockTransferPayload(BaseModel):
    stock_item_id: int
    source_location_id: int
    destination_location_id: int
    quantity: float
    remarks: str | None = None


class StockTransactionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    stock_item_id: int
    location_id: int
    type: str
    quantity: float
    reference_type: str | None = None
    reference_id: int | None = None
    performed_by_id: int | None = None
    remarks: str | None = None
    created_at: datetime | None = None

    # Denormalized, filled in by the route.
    stock_item_description: str | None = None
    location_name: str | None = None
    performed_by_name: str | None = None
