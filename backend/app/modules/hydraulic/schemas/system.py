from datetime import date, datetime
from pydantic import BaseModel, Field


class HydSystemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    system_type: str = "hydraulic"
    application: str | None = Field(None, max_length=200)
    status: str = "design"
    erp_project_id: int | None = None
    branch_id: int | None = None
    equipment_ref: str | None = Field(None, max_length=150)
    location: str | None = Field(None, max_length=200)
    working_pressure_bar: float | None = Field(None, ge=0)
    max_pressure_bar: float | None = Field(None, ge=0)
    flow_rate: float | None = Field(None, ge=0)
    reservoir_capacity_l: float | None = Field(None, ge=0)
    prime_mover_kw: float | None = Field(None, ge=0)
    fluid_medium: str | None = Field(None, max_length=150)
    filtration_micron: float | None = Field(None, ge=0)
    cleanliness_target: str | None = Field(None, max_length=30)
    operating_temp_min_c: float | None = None
    operating_temp_max_c: float | None = None
    commissioned_on: date | None = None
    running_hours: float = Field(0.0, ge=0)
    owner_id: int | None = None
    description: str | None = None
    remarks: str | None = None


class HydSystemUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    application: str | None = Field(None, max_length=200)
    status: str | None = None
    erp_project_id: int | None = None
    branch_id: int | None = None
    equipment_ref: str | None = Field(None, max_length=150)
    location: str | None = Field(None, max_length=200)
    working_pressure_bar: float | None = Field(None, ge=0)
    max_pressure_bar: float | None = Field(None, ge=0)
    flow_rate: float | None = Field(None, ge=0)
    reservoir_capacity_l: float | None = Field(None, ge=0)
    prime_mover_kw: float | None = Field(None, ge=0)
    fluid_medium: str | None = Field(None, max_length=150)
    filtration_micron: float | None = Field(None, ge=0)
    cleanliness_target: str | None = Field(None, max_length=30)
    operating_temp_min_c: float | None = None
    operating_temp_max_c: float | None = None
    commissioned_on: date | None = None
    running_hours: float | None = Field(None, ge=0)
    owner_id: int | None = None
    description: str | None = None
    remarks: str | None = None


class HydSystemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    system_number: str
    name: str
    system_type: str
    application: str | None = None
    status: str
    erp_project_id: int | None = None
    branch_id: int | None = None
    equipment_ref: str | None = None
    location: str | None = None
    working_pressure_bar: float | None = None
    max_pressure_bar: float | None = None
    flow_rate: float | None = None
    reservoir_capacity_l: float | None = None
    prime_mover_kw: float | None = None
    fluid_medium: str | None = None
    filtration_micron: float | None = None
    cleanliness_target: str | None = None
    operating_temp_min_c: float | None = None
    operating_temp_max_c: float | None = None
    commissioned_on: date | None = None
    running_hours: float
    owner_id: int | None = None
    description: str | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    project_label: str | None = None
    branch_name: str | None = None
    owner_name: str | None = None
    created_by_name: str | None = None
    circuit_count: int = 0
    bom_count: int = 0
    test_count: int = 0
    open_service_count: int = 0
    overdue_plan_count: int = 0
