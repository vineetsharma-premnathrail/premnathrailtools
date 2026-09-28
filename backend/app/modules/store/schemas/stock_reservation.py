from datetime import date
from pydantic import BaseModel


class StoreStockReservationCreate(BaseModel):
    item_id: int
    location_id: int
    quantity: float
    project: str | None = None
    production_order: str | None = None
    required_date: date | None = None
    remarks: str | None = None


class StoreStockReservationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    reservation_number: str
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    location_id: int
    location_name: str | None = None
    quantity: float
    project: str | None = None
    production_order: str | None = None
    reserved_by_id: int | None = None
    reserved_by_name: str | None = None
    required_date: date | None = None
    status: str
    remarks: str | None = None
