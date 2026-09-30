from datetime import date, datetime
from pydantic import BaseModel, Field


class HydTestReadingPayload(BaseModel):
    parameter: str = Field(min_length=1, max_length=200)
    unit: str | None = Field(None, max_length=30)
    specification: str | None = Field(None, max_length=255)
    min_value: float | None = None
    max_value: float | None = None
    measured_value: float | None = None
    measured_text: str | None = Field(None, max_length=255)
    # Only used when there are no numeric limits to judge by.
    result: str = "na"
    remarks: str | None = None


class HydTestReadingResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    parameter: str
    unit: str | None = None
    specification: str | None = None
    min_value: float | None = None
    max_value: float | None = None
    measured_value: float | None = None
    measured_text: str | None = None
    result: str
    remarks: str | None = None
    sort_order: int


class HydTestCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    test_type: str
    system_type: str = "hydraulic"
    system_id: int | None = None
    component_id: int | None = None
    component_serial: str | None = Field(None, max_length=100)
    test_date: date | None = None
    test_standard: str | None = Field(None, max_length=150)
    test_pressure_bar: float | None = Field(None, ge=0)
    hold_time_min: float | None = Field(None, ge=0)
    test_medium: str | None = Field(None, max_length=100)
    ambient_temp_c: float | None = None
    fluid_temp_c: float | None = None
    tested_by_id: int | None = None
    witnessed_by: str | None = Field(None, max_length=200)
    observations: str | None = None
    remarks: str | None = None
    readings: list[HydTestReadingPayload] = []


class HydTestUpdate(BaseModel):
    """Not allowed once completed. `readings`, when sent, replaces the full list."""
    title: str | None = Field(None, min_length=1, max_length=255)
    test_type: str | None = None
    system_id: int | None = None
    component_id: int | None = None
    component_serial: str | None = Field(None, max_length=100)
    test_date: date | None = None
    test_standard: str | None = Field(None, max_length=150)
    test_pressure_bar: float | None = Field(None, ge=0)
    hold_time_min: float | None = Field(None, ge=0)
    test_medium: str | None = Field(None, max_length=100)
    ambient_temp_c: float | None = None
    fluid_temp_c: float | None = None
    tested_by_id: int | None = None
    witnessed_by: str | None = Field(None, max_length=200)
    observations: str | None = None
    remarks: str | None = None
    readings: list[HydTestReadingPayload] | None = None


class HydTestCompletePayload(BaseModel):
    result: str
    remarks: str | None = None


class HydTestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    test_number: str
    title: str
    test_type: str
    system_type: str
    system_id: int | None = None
    component_id: int | None = None
    component_serial: str | None = None
    status: str
    result: str
    test_date: date | None = None
    test_standard: str | None = None
    test_pressure_bar: float | None = None
    hold_time_min: float | None = None
    test_medium: str | None = None
    ambient_temp_c: float | None = None
    fluid_temp_c: float | None = None
    tested_by_id: int | None = None
    witnessed_by: str | None = None
    observations: str | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    completed_by_id: int | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    readings: list[HydTestReadingResponse] = []

    # Denormalized display fields, filled in by the route.
    system_number: str | None = None
    system_name: str | None = None
    component_code: str | None = None
    component_name: str | None = None
    tested_by_name: str | None = None
    completed_by_name: str | None = None
    failed_readings: int = 0
