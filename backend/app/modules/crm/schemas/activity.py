from datetime import date, datetime
from pydantic import BaseModel


class ActivityAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    filename: str
    content_type: str | None = None
    size: int | None = None
    sharepoint_url: str | None = None
    created_at: datetime | None = None


class MomItem(BaseModel):
    observation: str | None = None
    action_plan: str | None = None
    responsibility: str | None = None
    # Free text (not a strict date) — typed as its own numbered-list point,
    # same as observation/action_plan, so it isn't tied to a single date-picker.
    target_date: str | None = None


class ActivityCreate(BaseModel):
    activity_type: str | None = None
    subject: str | None = None
    org_id: int | None = None
    org_contact_id: int | None = None
    contact_ids: list[int] | None = None
    related_module: str | None = None
    related_id: int | None = None
    universal_id: str | None = None
    activity_date: date | None = None
    next_followup: date | None = None
    assigned_to: str | None = None
    status: str = "Open"
    remarks: str | None = None
    action_plan: str | None = None
    mom_items: list[MomItem] | None = None


class ActivityUpdate(BaseModel):
    activity_type: str | None = None
    subject: str | None = None
    org_contact_id: int | None = None
    contact_ids: list[int] | None = None
    activity_date: date | None = None
    next_followup: date | None = None
    assigned_to: str | None = None
    status: str | None = None
    remarks: str | None = None
    action_plan: str | None = None
    mom_items: list[MomItem] | None = None


class ActivityResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    activity_type: str | None = None
    subject: str | None = None
    org_id: int | None = None
    org_contact_id: int | None = None
    contact_ids: list[int] | None = None
    related_module: str | None = None
    related_id: int | None = None
    universal_id: str | None = None
    activity_date: date | None = None
    next_followup: date | None = None
    assigned_to: str | None = None
    status: str
    remarks: str | None = None
    action_plan: str | None = None
    mom_items: list[MomItem] | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    # Display-only, filled in by the route (not stored on the Activity row
    # itself) — see `_enrich()` in routes/activities.py.
    contact_names: list[str] = []
    related_label: str | None = None
    created_by_name: str | None = None
    attachments: list[ActivityAttachmentResponse] = []


class MomExportRequest(BaseModel):
    subject: str
    meeting_date: date
    pew_member_ids: list[int] = []
    client_contact_ids: list[int] = []
    activity_ids: list[int] = []
