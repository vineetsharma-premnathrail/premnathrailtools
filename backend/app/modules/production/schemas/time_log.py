from datetime import date, datetime
from pydantic import BaseModel, Field


class ProductionTimeLogCreate(BaseModel):
    work_order_id: int
    operation_id: int
    operator_id: int | None = None
    log_date: date
    hours: float = Field(gt=0, le=24)
    qty_good: float = Field(0.0, ge=0)
    qty_scrap: float = Field(0.0, ge=0)
    remarks: str | None = None


class ProductionTimeLogResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    work_order_id: int
    operation_id: int | None = None
    workstation_id: int | None = None
    operator_id: int | None = None
    log_date: date
    hours: float
    qty_good: float
    qty_scrap: float
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    wo_number: str | None = None
    operation_label: str | None = None
    workstation_name: str | None = None
    operator_name: str | None = None
