from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class HydCalculationComputePayload(BaseModel):
    calc_type: str
    inputs: dict[str, Any] = {}


class HydCalculationComputeResponse(BaseModel):
    calc_type: str
    inputs: dict[str, Any]
    results: list[dict[str, Any]]
    warnings: list[str] = []


class HydCalculationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    calc_type: str
    system_id: int | None = None
    inputs: dict[str, Any] = {}
    remarks: str | None = None


class HydCalculationUpdate(BaseModel):
    """Title/system/remarks only — change inputs by saving a new calculation."""
    title: str | None = Field(None, min_length=1, max_length=255)
    system_id: int | None = None
    remarks: str | None = None


class HydCalculationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    calc_number: str
    title: str
    calc_type: str
    system_type: str
    system_id: int | None = None
    inputs: dict[str, Any] = {}
    results: dict[str, Any] = {}
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    calc_type_label: str | None = None
    system_number: str | None = None
    system_name: str | None = None
    created_by_name: str | None = None
