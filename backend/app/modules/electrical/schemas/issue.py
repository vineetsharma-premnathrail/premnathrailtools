from datetime import datetime
from pydantic import BaseModel, Field


class ElectricalIssueCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    symptom: str | None = None
    severity: str = "major"
    test_id: int | None = None
    panel_id: int | None = None
    cable_id: int | None = None
    assigned_to_id: int | None = None


class ElectricalIssueUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    symptom: str | None = None
    severity: str | None = None
    status: str | None = None
    test_id: int | None = None
    panel_id: int | None = None
    cable_id: int | None = None
    root_cause: str | None = None
    corrective_action: str | None = None
    assigned_to_id: int | None = None


class ElectricalIssueResolvePayload(BaseModel):
    root_cause: str = Field(min_length=1)
    corrective_action: str = Field(min_length=1)


class ElectricalIssueResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    job_id: int
    issue_number: str
    title: str
    symptom: str | None = None
    severity: str
    status: str
    test_id: int | None = None
    panel_id: int | None = None
    cable_id: int | None = None
    root_cause: str | None = None
    corrective_action: str | None = None
    reported_by_id: int | None = None
    assigned_to_id: int | None = None
    resolved_by_id: int | None = None
    resolved_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    job_number: str | None = None
    job_title: str | None = None
    test_number: str | None = None
    panel_tag: str | None = None
    cable_tag: str | None = None
    reported_by_name: str | None = None
    assigned_to_name: str | None = None
    resolved_by_name: str | None = None
