from datetime import date, datetime
from pydantic import BaseModel


class ActivityCreate(BaseModel):
    activity_type: str | None = None
    org_id: int | None = None
    org_contact_id: int | None = None
    related_module: str | None = None
    related_id: int | None = None
    universal_id: str | None = None
    next_followup: date | None = None
    assigned_to: str | None = None
    status: str = "Open"
    remarks: str | None = None
    action_plan: str | None = None


class ActivityUpdate(BaseModel):
    activity_type: str | None = None
    next_followup: date | None = None
    assigned_to: str | None = None
    status: str | None = None
    remarks: str | None = None
    action_plan: str | None = None


class ActivityResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    activity_type: str | None = None
    org_id: int | None = None
    org_contact_id: int | None = None
    related_module: str | None = None
    related_id: int | None = None
    universal_id: str | None = None
    next_followup: date | None = None
    assigned_to: str | None = None
    status: str
    remarks: str | None = None
    action_plan: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None


class MomExportRequest(BaseModel):
    subject: str
    meeting_date: date
    pew_member_ids: list[int] = []
    client_contact_ids: list[int] = []
    activity_ids: list[int] = []
