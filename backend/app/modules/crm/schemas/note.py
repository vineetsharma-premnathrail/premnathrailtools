from datetime import datetime
from pydantic import BaseModel


class NoteCreate(BaseModel):
    org_id: int | None = None
    org_contact_id: int | None = None
    related_module: str | None = None
    related_id: int | None = None
    universal_id: str | None = None
    note: str


class NoteUpdate(BaseModel):
    note: str | None = None


class NoteResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    org_id: int | None = None
    org_contact_id: int | None = None
    related_module: str | None = None
    related_id: int | None = None
    universal_id: str | None = None
    note: str
    created_by_name: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
