from datetime import date, datetime
from pydantic import BaseModel, Field


class ElectricalTestCreate(BaseModel):
    phase: str = "factory"
    test_type: str
    circuit: str | None = Field(None, max_length=150)
    panel_id: int | None = None
    cable_id: int | None = None
    instrument: str | None = Field(None, max_length=150)
    expected_value: str | None = Field(None, max_length=100)
    measured_value: str | None = Field(None, max_length=100)
    unit: str | None = Field(None, max_length=20)
    result: str
    test_date: date
    tested_by_id: int | None = None
    retest_of_id: int | None = None
    remarks: str | None = None


class ElectricalTestUpdate(BaseModel):
    circuit: str | None = Field(None, max_length=150)
    panel_id: int | None = None
    cable_id: int | None = None
    instrument: str | None = Field(None, max_length=150)
    expected_value: str | None = Field(None, max_length=100)
    measured_value: str | None = Field(None, max_length=100)
    unit: str | None = Field(None, max_length=20)
    test_date: date | None = None
    tested_by_id: int | None = None
    remarks: str | None = None


class ElectricalTestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    job_id: int
    test_number: str
    phase: str
    test_type: str
    circuit: str | None = None
    panel_id: int | None = None
    cable_id: int | None = None
    instrument: str | None = None
    expected_value: str | None = None
    measured_value: str | None = None
    unit: str | None = None
    result: str
    test_date: date
    tested_by_id: int | None = None
    retest_of_id: int | None = None
    remarks: str | None = None
    created_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    job_number: str | None = None
    job_title: str | None = None
    panel_tag: str | None = None
    cable_tag: str | None = None
    tested_by_name: str | None = None
    retest_of_number: str | None = None
    # A failed test with no retest recorded yet.
    needs_retest: bool = False
