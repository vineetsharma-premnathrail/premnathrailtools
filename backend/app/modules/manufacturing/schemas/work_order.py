from pydantic import BaseModel


class WorkOrderCreate(BaseModel):
    bom_id: int
    quantity: float
    remarks: str | None = None


class WorkOrderUpdate(BaseModel):
    status: str | None = None
    remarks: str | None = None


class WorkOrderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    wo_number: str
    bom_id: int
    quantity: float
    status: str
    remarks: str | None = None
    bom_name: str | None = None
    created_by_name: str | None = None
