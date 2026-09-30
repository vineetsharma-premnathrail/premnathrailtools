from datetime import datetime
from pydantic import BaseModel, Field


class ElectricalDrawingRevisionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    drawing_id: int
    revision_index: int
    revision_label: str
    status: str
    change_summary: str | None = None
    file_name: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    prepared_by_id: int | None = None
    submitted_at: datetime | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_comment: str | None = None
    created_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    prepared_by_name: str | None = None
    decided_by_name: str | None = None
    has_file: bool = False


class ElectricalDrawingUpdate(BaseModel):
    drawing_number: str | None = Field(None, min_length=1, max_length=80)
    title: str | None = Field(None, min_length=1, max_length=255)
    drawing_type: str | None = None
    is_as_built: bool | None = None
    description: str | None = None


class ElectricalRevisionDecisionPayload(BaseModel):
    comment: str | None = None


class ElectricalDrawingResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    job_id: int
    drawing_number: str
    title: str
    drawing_type: str
    is_as_built: bool
    description: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    job_number: str | None = None
    job_title: str | None = None
    revisions: list[ElectricalDrawingRevisionResponse] = []
    latest_revision_label: str | None = None
    latest_revision_status: str | None = None
    approved_revision_label: str | None = None
