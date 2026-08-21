from pydantic import BaseModel


class StockBalanceResponse(BaseModel):
    stock_item_id: int
    part_code: str
    description: str
    unit: str | None = None
    quantity_on_hand: float


class StockAdjustPayload(BaseModel):
    stock_item_id: int
    location_id: int
    counted_quantity: float
    remarks: str | None = None
