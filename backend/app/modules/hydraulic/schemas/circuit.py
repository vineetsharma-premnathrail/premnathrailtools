from datetime import datetime
from pydantic import BaseModel, Field


class HydCircuitCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    system_type: str = "hydraulic"
    system_id: int | None = None
    drawing_number: str | None = Field(None, max_length=100)
    symbol_standard: str | None = Field("ISO 1219-1", max_length=100)
    description: str | None = None
    change_note: str | None = None


class HydCircuitUpdate(BaseModel):
    """Draft-only."""
    title: str | None = Field(None, min_length=1, max_length=255)
    system_id: int | None = None
    drawing_number: str | None = Field(None, max_length=100)
    symbol_standard: str | None = Field(None, max_length=100)
    description: str | None = None
    change_note: str | None = None


class HydCircuitReviewPayload(BaseModel):
    remarks: str | None = None


class HydCircuitRevisePayload(BaseModel):
    change_note: str = Field(min_length=1)


class HydCircuitRevisionSummary(BaseModel):
    id: int
    revision: str
    status: str
    approved_at: datetime | None = None
    change_note: str | None = None


class HydCircuitResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    circuit_number: str
    revision: str
    title: str
    system_type: str
    system_id: int | None = None
    status: str
    drawing_number: str | None = None
    symbol_standard: str | None = None
    description: str | None = None
    change_note: str | None = None
    created_by_id: int | None = None
    submitted_by_id: int | None = None
    submitted_at: datetime | None = None
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    review_remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    system_number: str | None = None
    system_name: str | None = None
    created_by_name: str | None = None
    submitted_by_name: str | None = None
    approved_by_name: str | None = None
    document_count: int = 0
    revisions: list[HydCircuitRevisionSummary] = []
