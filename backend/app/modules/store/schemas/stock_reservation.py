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
    # Project stock: the Order Project vehicle / lot this stock is held for
    # (element required when a project is given).
    order_project_id: int | None = None
    order_project_element_id: int | None = None


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
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    op_number: str | None = None
    element_no: str | None = None
    element_label: str | None = None
    source_type: str | None = None
    source_reference: str | None = None
    original_qty: float | None = None
