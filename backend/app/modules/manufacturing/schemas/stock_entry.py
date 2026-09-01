from pydantic import BaseModel


class StockEntryCreate(BaseModel):
    material_id: int
    work_order_id: int | None = None
    type: str
    quantity: float
    remarks: str | None = None


class StockEntryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    material_id: int
    work_order_id: int | None = None
    type: str
    quantity: float
    remarks: str | None = None
    material_name: str | None = None
    material_code: str | None = None
    wo_number: str | None = None
    created_by_name: str | None = None
