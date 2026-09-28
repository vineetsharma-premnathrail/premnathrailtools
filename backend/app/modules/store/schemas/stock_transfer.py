from datetime import date
from pydantic import BaseModel


class StoreStockTransferItemPayload(BaseModel):
    item_id: int
    quantity: float
    batch_number: str | None = None
    remarks: str | None = None


class StoreStockTransferItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    quantity: float
    batch_number: str | None = None
    remarks: str | None = None


class StoreStockTransferCreate(BaseModel):
    from_location_id: int
    to_location_id: int
    transfer_date: date | None = None
    reason: str | None = None
    remarks: str | None = None
    items: list[StoreStockTransferItemPayload]


class StoreStockTransferResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    transfer_number: str
    from_location_id: int
    from_location_name: str | None = None
    to_location_id: int
    to_location_name: str | None = None
    transfer_date: date
    reason: str | None = None
    transferred_by_id: int | None = None
    transferred_by_name: str | None = None
    remarks: str | None = None
    items: list[StoreStockTransferItemResponse] = []
