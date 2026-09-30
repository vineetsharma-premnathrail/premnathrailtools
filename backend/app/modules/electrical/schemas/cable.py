from datetime import datetime
from pydantic import BaseModel, Field


class ElectricalCableCreate(BaseModel):
    cable_tag: str = Field(min_length=1, max_length=50)
    circuit: str | None = Field(None, max_length=150)
    from_point: str = Field(min_length=1, max_length=150)
    to_point: str = Field(min_length=1, max_length=150)
    cable_type: str | None = Field(None, max_length=100)
    cores: int | None = Field(None, ge=1, le=200)
    size_sqmm: float | None = Field(None, gt=0)
    length_m: float | None = Field(None, gt=0)
    voltage_rating: str | None = Field(None, max_length=50)
    color_code: str | None = Field(None, max_length=50)
    harness_ref: str | None = Field(None, max_length=50)
    status: str = "designed"
    remarks: str | None = None


class ElectricalCableUpdate(BaseModel):
    cable_tag: str | None = Field(None, min_length=1, max_length=50)
    circuit: str | None = Field(None, max_length=150)
    from_point: str | None = Field(None, min_length=1, max_length=150)
    to_point: str | None = Field(None, min_length=1, max_length=150)
    cable_type: str | None = Field(None, max_length=100)
    cores: int | None = Field(None, ge=1, le=200)
    size_sqmm: float | None = Field(None, gt=0)
    length_m: float | None = Field(None, gt=0)
    voltage_rating: str | None = Field(None, max_length=50)
    color_code: str | None = Field(None, max_length=50)
    harness_ref: str | None = Field(None, max_length=50)
    status: str | None = None
    remarks: str | None = None


class ElectricalCableBulkStatusPayload(BaseModel):
    cable_ids: list[int] = Field(min_length=1)
    status: str


class ElectricalCableResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    job_id: int
    cable_tag: str
    circuit: str | None = None
    from_point: str
    to_point: str
    cable_type: str | None = None
    cores: int | None = None
    size_sqmm: float | None = None
    length_m: float | None = None
    voltage_rating: str | None = None
    color_code: str | None = None
    harness_ref: str | None = None
    status: str
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
