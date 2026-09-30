from datetime import datetime
from pydantic import BaseModel


class ElectricalDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    job_id: int
    stage_key: str | None = None
    category: str
    title: str
    description: str | None = None
    file_name: str
    file_size: int | None = None
    mime_type: str | None = None
    uploaded_by_id: int | None = None
    created_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    uploaded_by_name: str | None = None
    stage_label: str | None = None
