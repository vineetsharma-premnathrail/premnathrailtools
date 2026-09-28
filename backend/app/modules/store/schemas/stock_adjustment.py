from datetime import date
from pydantic import BaseModel


class StoreStockAdjustmentItemPayload(BaseModel):
    item_id: int
    actual_quantity: float
    remarks: str | None = None


class StoreStockAdjustmentItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    existing_quantity: float
    actual_quantity: float
    difference: float
    remarks: str | None = None


class StoreStockAdjustmentCreate(BaseModel):
    location_id: int
    approved_by_id: int
    adjustment_date: date | None = None
    reason: str | None = None
    remarks: str | None = None
    items: list[StoreStockAdjustmentItemPayload]


class StoreStockAdjustmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    adjustment_number: str
    location_id: int
    location_name: str | None = None
    adjustment_date: date
    reason: str | None = None
    approved_by_id: int | None = None
    approved_by_name: str | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    remarks: str | None = None
    items: list[StoreStockAdjustmentItemResponse] = []
