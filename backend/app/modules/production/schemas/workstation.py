from datetime import datetime
from pydantic import BaseModel, Field


class ProductionWorkstationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=150)
    workstation_type: str = "machine"
    branch_id: int | None = None
    department_id: int | None = None
    capacity_hours_per_day: float = Field(8.0, ge=0, le=24)
    hourly_rate: float = Field(0.0, ge=0)
    status: str = "active"
    description: str | None = None


class ProductionWorkstationUpdate(BaseModel):
    code: str | None = Field(None, min_length=1, max_length=30)
    name: str | None = Field(None, min_length=1, max_length=150)
    workstation_type: str | None = None
    branch_id: int | None = None
    department_id: int | None = None
    capacity_hours_per_day: float | None = Field(None, ge=0, le=24)
    hourly_rate: float | None = Field(None, ge=0)
    status: str | None = None
    description: str | None = None


class ProductionWorkstationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    workstation_type: str
    branch_id: int | None = None
    department_id: int | None = None
    capacity_hours_per_day: float
    hourly_rate: float
    status: str
    description: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    branch_name: str | None = None
    department_name: str | None = None
    open_operations: int = 0
